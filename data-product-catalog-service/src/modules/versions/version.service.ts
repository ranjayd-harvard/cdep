import { AppError } from "../../common/errors/app-error.js";
import { localProductVisibilityResolver } from "../discovery/product-visibility-resolver.js";
import { findProduct } from "../products/product.repository.js";
import { findVersion, listVersions } from "./version.repository.js";
import { listSchemaFields } from "./schema-field.repository.js";
import { listDeliveryMethods } from "../delivery/delivery.repository.js";
import { findSlaPolicy } from "../sla/sla.repository.js";
import { findQualityPolicy } from "../quality/quality.repository.js";
import { toCustomerVersionDetail, toCustomerVersionSummary } from "./version-projection.js";

async function requireVisibleProduct(dataProductId: string) {
  const product = await findProduct(dataProductId);
  if (
    !product ||
    !localProductVisibilityResolver.isVisible({
      dataProductId,
      discoverable: product.discoverable,
      status: product.status,
    })
  ) {
    throw new AppError("PRODUCT_NOT_FOUND", "The requested Data Product was not found.");
  }
  return product;
}

// Phase 10 §36: DRAFT is never listed here, and BETA is deliberately
// blind on this public, unauthenticated route — it has no tenant context
// to check an opt-in against (spec §11/§18), and Catalog doesn't own
// tenant authentication. BETA-version discovery belongs to subscription-
// service's tenant-aware customer routes instead; adding tenant auth here
// would duplicate that, for no benefit.
const CUSTOMER_VISIBLE_STATUSES = new Set(["ACTIVE", "DEPRECATED", "RETIRED"]);

export async function listCustomerVersions(dataProductId: string) {
  await requireVisibleProduct(dataProductId);
  const versions = await listVersions(dataProductId);
  return versions.filter((v) => CUSTOMER_VISIBLE_STATUSES.has(v.lifecycle_status)).map(toCustomerVersionSummary);
}

export async function getCustomerVersionDetail(dataProductId: string, version: string) {
  await requireVisibleProduct(dataProductId);
  const versionRow = await findVersion(dataProductId, version);
  if (!versionRow || !CUSTOMER_VISIBLE_STATUSES.has(versionRow.lifecycle_status)) {
    throw new AppError("VERSION_NOT_FOUND", `Version '${version}' of '${dataProductId}' was not found.`);
  }
  const [fields, delivery, sla, quality] = await Promise.all([
    listSchemaFields(versionRow.data_product_version_id),
    listDeliveryMethods(versionRow.data_product_version_id),
    findSlaPolicy(versionRow.data_product_version_id),
    findQualityPolicy(versionRow.data_product_version_id),
  ]);
  return toCustomerVersionDetail({ version: versionRow, fields, delivery, sla, quality });
}

export interface ApiContractDTO {
  dataProductId: string;
  version: string;
  lifecycleStatus: string;
  resource: string;
  publishedFields: Array<{ name: string; type: string; nullable: boolean; maskingPolicy: string | null }>;
  filters: string[];
  sorts: string[];
  defaultSort: string[];
  defaultPageSize: number;
  maxPageSize: number;
  maxResponseBytes: number | null;
  freshnessMinutes: number | null;
}

// Backs GET /internal/v1/versions/api-contract (Phase 8, data-product-api-service).
// This is the single Contract-driven source of truth for what a customer
// may query and receive over the API — the query engine allowlists filters/
// sorts against exactly this, and the response projector serializes only
// `publishedFields` (spec §8.2/§8.7/§8.9: "never derive public API fields
// automatically", "no second API-specific product registry"). Internal-only:
// no visibility/discoverability gate — the caller has already independently
// authenticated, entitlement-checked, and subscription-resolved the caller
// down to this exact (dataProductId, version) before ever asking Catalog.
export async function getApiContract(dataProductId: string, version: string): Promise<ApiContractDTO> {
  const product = await findProduct(dataProductId);
  if (!product) {
    throw new AppError("PRODUCT_NOT_FOUND", `Data product '${dataProductId}' was not found.`);
  }
  const versionRow = await findVersion(dataProductId, version);
  if (!versionRow) {
    throw new AppError("VERSION_NOT_FOUND", `Version '${version}' of '${dataProductId}' was not found.`);
  }

  const [fields, delivery, sla] = await Promise.all([
    listSchemaFields(versionRow.data_product_version_id),
    listDeliveryMethods(versionRow.data_product_version_id),
    findSlaPolicy(versionRow.data_product_version_id),
  ]);

  const apiMethod = delivery.find((m) => m.method === "API" && m.enabled);
  if (!apiMethod) {
    throw new AppError(
      "API_DELIVERY_NOT_CONFIGURED",
      `Version '${version}' of '${dataProductId}' does not have API delivery enabled.`,
    );
  }
  const config = apiMethod.configuration as {
    resource?: string;
    filters?: string[];
    sorts?: string[];
    defaultSort?: string[];
    defaultPageSize?: number;
    maxPageSize?: number;
    maxResponseBytes?: number;
  };
  if (!config.resource) {
    throw new AppError(
      "API_DELIVERY_NOT_CONFIGURED",
      `Version '${version}' of '${dataProductId}' has API delivery enabled but no query policy configured.`,
    );
  }

  return {
    dataProductId,
    version: versionRow.version,
    lifecycleStatus: versionRow.lifecycle_status,
    resource: config.resource,
    // Phase 11 (spec §21): a DENY field is excluded even if customer_visible
    // was left true, same "DENY always wins" rule data-publication-service's
    // loader applies for FILE delivery, so both delivery methods agree.
    publishedFields: fields
      .filter((f) => f.customer_visible && f.masking_policy !== "DENY")
      .map((f) => ({ name: f.field_name, type: f.data_type, nullable: f.nullable, maskingPolicy: f.masking_policy })),
    filters: config.filters ?? [],
    sorts: config.sorts ?? [],
    defaultSort: config.defaultSort ?? [],
    defaultPageSize: config.defaultPageSize ?? 100,
    maxPageSize: config.maxPageSize ?? 500,
    maxResponseBytes: config.maxResponseBytes ?? null,
    freshnessMinutes: sla?.freshness_minutes ?? null,
  };
}
