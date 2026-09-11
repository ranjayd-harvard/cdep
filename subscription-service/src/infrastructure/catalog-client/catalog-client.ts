import { AppError } from "../../common/errors/app-error.js";
import { catalogServiceEnabled, env } from "../../config/env.js";
import type { VersionPolicy } from "../../domain/version-policy.js";

/**
 * Client for data-product-catalog-service (Phase 5) — the runtime
 * authoritative registry for Data Products/versions/schemas/contracts/SLA/
 * quality/delivery metadata. Mirrors the portal's
 * `src/lib/catalog-service/client.ts`: `/v1/*` needs no auth, `/internal/v1/*`
 * sends `x-internal-api-key` + actor headers. Never call raw Catalog HTTP
 * endpoints from domain/application code — always go through here (spec §46).
 */

export class CatalogUnavailableError extends AppError {
  constructor(message: string) {
    super("CATALOG_UNAVAILABLE", message);
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

interface CatalogDeliveryMethodDTO {
  type: string;
  formats?: string[];
}

export interface CatalogVersionDetailDTO {
  version: string;
  lifecycleStatus: string;
  delivery: CatalogDeliveryMethodDTO[];
}

export interface CatalogVersionSummaryDTO {
  version: string;
  lifecycleStatus: string;
}

export interface CatalogProductDetailDTO {
  dataProductId: string;
  name: string;
  status: string;
  activeVersion: CatalogVersionDetailDTO | null;
  versionHistory: CatalogVersionSummaryDTO[];
}

async function catalogFetch<T>(
  path: string,
  options: { internal?: boolean; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  if (!catalogServiceEnabled) {
    throw new CatalogUnavailableError("CATALOG_SERVICE_URL is not configured.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.internal) {
    headers["x-internal-api-key"] = env.CATALOG_SERVICE_INTERNAL_API_KEY;
    headers["x-actor-type"] = "SERVICE";
    headers["x-actor-id"] = "subscription-service";
    headers["x-actor-role"] = "CATALOG_READER";
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.CATALOG_SERVICE_TIMEOUT_SECONDS * 1000);
    try {
      response = await fetch(`${env.CATALOG_SERVICE_URL}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new CatalogUnavailableError(`Catalog Service request to ${path} failed: ${(err as Error).message}`);
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    json = undefined;
  }

  if (response.status >= 500) {
    throw new CatalogUnavailableError(`Catalog Service returned ${response.status} for ${path}.`);
  }

  if (response.status === 404) {
    throw new AppError("PRODUCT_NOT_FOUND", `Data product referenced by ${path} was not found in the Catalog.`);
  }

  if (!response.ok) {
    const envelope = json as ErrorEnvelope | undefined;
    throw new AppError(
      "VALIDATION_ERROR",
      envelope?.error?.message ?? `Catalog Service request to ${path} failed with status ${response.status}.`,
    );
  }

  return json as T;
}

export function getCatalogProduct(dataProductId: string): Promise<CatalogProductDetailDTO> {
  return catalogFetch<CatalogProductDetailDTO>(`/v1/data-products/${encodeURIComponent(dataProductId)}`);
}

export function getCatalogVersion(dataProductId: string, version: string): Promise<CatalogVersionDetailDTO> {
  return catalogFetch<CatalogVersionDetailDTO>(
    `/v1/data-products/${encodeURIComponent(dataProductId)}/versions/${encodeURIComponent(version)}`,
  );
}

export function listCatalogVersions(dataProductId: string): Promise<{ items: CatalogVersionSummaryDTO[] }> {
  return catalogFetch<{ items: CatalogVersionSummaryDTO[] }>(
    `/v1/data-products/${encodeURIComponent(dataProductId)}/versions`,
  );
}

export interface ResolvedVersion {
  version: string;
  lifecycleStatus: string;
  fellBackToDeprecated?: boolean;
}

export type ResolutionIntent = "SUBSCRIBE" | "DELIVER";

// Phase 10 §27/§30: a thin wrapper on Catalog's centralized resolver —
// Catalog is now the sole authority for version-ranking logic across all
// five policy types (EXACT/COMPATIBLE_PATCH/COMPATIBLE_MINOR/PINNED_MAJOR/
// LATEST_ACTIVE). This replaces the local majorOf/filter/sort algorithm
// that used to live here and only ever knew 3 policy types — it filtered
// to ACTIVE only, which meant a PINNED_MAJOR/COMPATIBLE_MINOR subscriber
// would get VERSION_POLICY_NOT_RESOLVABLE the instant their major version's
// canonical ACTIVE version rotated to DEPRECATED, even though a perfectly
// good DEPRECATED-but-serving version within their pinned range was still
// available. Catalog's resolver fixes this via the SUBSCRIBE/DELIVER
// intent split (spec §29).
export async function resolveVersionPolicy(
  dataProductId: string,
  policy: VersionPolicy,
  intent: ResolutionIntent,
  tenant?: { organizationId: string; tenantId: string },
  preferredVersion?: string,
): Promise<ResolvedVersion> {
  try {
    const result = await catalogFetch<{ resolved_version: string; lifecycle_status: string; fell_back_to_deprecated: boolean }>(
      `/internal/v1/data-products/${encodeURIComponent(dataProductId)}/resolve-version`,
      {
        internal: true,
        method: "POST",
        body: {
          policy,
          intent,
          organizationId: tenant?.organizationId,
          tenantId: tenant?.tenantId,
          preferredVersion,
        },
      },
    );
    return { version: result.resolved_version, lifecycleStatus: result.lifecycle_status, fellBackToDeprecated: result.fell_back_to_deprecated };
  } catch (err) {
    if (err instanceof AppError) {
      throw new AppError("VERSION_POLICY_NOT_RESOLVABLE", err.message);
    }
    throw err;
  }
}

// Spec §24/§29 — Catalog remains authoritative for which delivery
// methods/formats a version actually supports.
export async function validateDeliveryCapability(
  dataProductId: string,
  version: string,
  method: string,
  format: string | null,
): Promise<void> {
  const detail = await getCatalogVersion(dataProductId, version);
  const supported = detail.delivery.find((d) => d.type === method);
  if (!supported) {
    throw new AppError(
      "DELIVERY_METHOD_NOT_SUPPORTED",
      `Data product '${dataProductId}' version ${version} does not support ${method} delivery.`,
    );
  }
  if (format) {
    if (!supported.formats || !supported.formats.includes(format)) {
      throw new AppError(
        "FILE_FORMAT_NOT_SUPPORTED",
        `Data product '${dataProductId}' version ${version} does not support the ${format} format for ${method} delivery.`,
      );
    }
  }
}

export async function assertProductActive(dataProductId: string): Promise<CatalogProductDetailDTO> {
  const product = await getCatalogProduct(dataProductId);
  if (product.status !== "ACTIVE") {
    throw new AppError("PRODUCT_NOT_ACTIVE", `Data product '${dataProductId}' is not ACTIVE in the Catalog.`);
  }
  return product;
}
