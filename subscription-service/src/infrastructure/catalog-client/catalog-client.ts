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

async function catalogFetch<T>(path: string, options: { internal?: boolean } = {}): Promise<T> {
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

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.CATALOG_SERVICE_TIMEOUT_SECONDS * 1000);
    try {
      response = await fetch(`${env.CATALOG_SERVICE_URL}${path}`, { headers, signal: controller.signal });
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

function majorOf(version: string): string | null {
  const match = /^(\d+)\./.exec(version);
  return match ? (match[1] as string) : null;
}

export interface ResolvedVersion {
  version: string;
  lifecycleStatus: string;
}

// Spec §20/§21 — EXACT looks up the specific version; COMPATIBLE_MAJOR and
// LATEST_ACTIVE pick the highest ACTIVE version, COMPATIBLE_MAJOR never
// crossing the requested major. Never binds permanently to a version for a
// floating policy — callers re-resolve at activation/resume time.
export async function resolveVersionPolicy(dataProductId: string, policy: VersionPolicy): Promise<ResolvedVersion> {
  if (policy.type === "EXACT") {
    const value = policy.value;
    if (!value) {
      throw new AppError("VERSION_POLICY_NOT_RESOLVABLE", "EXACT version policy requires a value.");
    }
    const version = await getCatalogVersion(dataProductId, value);
    return { version: version.version, lifecycleStatus: version.lifecycleStatus };
  }

  const { items } = await listCatalogVersions(dataProductId);
  const activeVersions = items.filter((v) => v.lifecycleStatus === "ACTIVE");

  const candidates =
    policy.type === "COMPATIBLE_MAJOR" ? activeVersions.filter((v) => majorOf(v.version) === policy.value) : activeVersions;

  if (candidates.length === 0) {
    throw new AppError(
      "VERSION_POLICY_NOT_RESOLVABLE",
      policy.type === "COMPATIBLE_MAJOR"
        ? `No ACTIVE version of '${dataProductId}' matches major version ${policy.value}.x.`
        : `'${dataProductId}' has no ACTIVE version.`,
    );
  }

  candidates.sort((a, b) => (a.version > b.version ? -1 : a.version < b.version ? 1 : 0));
  const best = candidates[0] as CatalogVersionSummaryDTO;
  return { version: best.version, lifecycleStatus: best.lifecycleStatus };
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
