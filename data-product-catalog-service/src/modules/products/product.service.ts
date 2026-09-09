import { AppError } from "../../common/errors/app-error.js";
import { localProductVisibilityResolver } from "../discovery/product-visibility-resolver.js";
import { findDomain } from "../domains/domain.repository.js";
import { findOwner } from "../owners/owner.repository.js";
import { findVersion, listVersions } from "../versions/version.repository.js";
import { listSchemaFields } from "../versions/schema-field.repository.js";
import { listDeliveryMethods } from "../delivery/delivery.repository.js";
import { findSlaPolicy } from "../sla/sla.repository.js";
import { findQualityPolicy } from "../quality/quality.repository.js";
import { toCustomerVersionDetail, toCustomerVersionSummary } from "../versions/version-projection.js";
import { findProduct, searchProducts, type DataProductRow, type ProductSearchFilters } from "./product.repository.js";

async function buildActiveVersionSummary(product: DataProductRow) {
  if (!product.current_active_version) return null;
  const version = await findVersion(product.data_product_id, product.current_active_version);
  if (!version) return null;
  const [fields, delivery, sla, quality] = await Promise.all([
    listSchemaFields(version.data_product_version_id),
    listDeliveryMethods(version.data_product_version_id),
    findSlaPolicy(version.data_product_version_id),
    findQualityPolicy(version.data_product_version_id),
  ]);
  return toCustomerVersionDetail({ version, fields, delivery, sla, quality });
}

export async function listCustomerProducts(filters: Omit<ProductSearchFilters, "discoverableOnly">) {
  const page = await searchProducts({ ...filters, discoverableOnly: true });
  const visible = page.items.filter((p) => localProductVisibilityResolver.isVisible({
    dataProductId: p.data_product_id,
    discoverable: p.discoverable,
    status: p.status,
  }));

  const items = await Promise.all(
    visible.map(async (product) => {
      const [domain, activeVersion] = await Promise.all([findDomain(product.domain_id), buildActiveVersionSummary(product)]);
      return {
        dataProductId: product.data_product_id,
        name: product.display_name,
        description: product.description,
        domain: domain ? { id: domain.domain_id, name: domain.display_name } : null,
        status: product.status,
        activeVersion: activeVersion?.version ?? null,
        lifecycleStatus: activeVersion?.lifecycleStatus ?? null,
        supportedDeliveryMethods: activeVersion?.delivery ?? [],
        freshnessMinutes: activeVersion?.sla?.freshnessMinutes ?? null,
      };
    }),
  );

  return { items, nextCursor: page.nextCursor };
}

export async function getCustomerProductDetail(dataProductId: string) {
  const product = await findProduct(dataProductId);
  if (!product || !localProductVisibilityResolver.isVisible({
    dataProductId: product?.data_product_id ?? dataProductId,
    discoverable: product?.discoverable ?? false,
    status: product?.status ?? "",
  })) {
    // Cross-tenant/undiscoverable existence is not revealed — a hidden
    // product looks identical to one that never existed (mirrors
    // data-exchange-service's not-found convention).
    throw new AppError("PRODUCT_NOT_FOUND", "The requested Data Product was not found.");
  }

  const [domain, owner, activeVersion, versionRows] = await Promise.all([
    findDomain(product.domain_id),
    findOwner(product.owner_id),
    buildActiveVersionSummary(product),
    listVersions(dataProductId),
  ]);

  return {
    dataProductId: product.data_product_id,
    name: product.display_name,
    description: product.description,
    domain: domain ? { id: domain.domain_id, name: domain.display_name } : null,
    owner: owner ? { displayName: owner.name, type: owner.owner_type } : null,
    status: product.status,
    activeVersion,
    versionHistory: versionRows.map(toCustomerVersionSummary),
  };
}
