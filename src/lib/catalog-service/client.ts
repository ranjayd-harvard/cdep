import { env } from "@/config/env";

/**
 * Server-only client for data-product-catalog-service (Phase 5) — the
 * runtime authoritative registry for Data Products/versions/schemas/
 * contracts/SLA/quality/delivery metadata. Structurally like
 * `src/lib/lakehouse-service/client.ts`: gated entirely by
 * `env.catalogServiceEnabled`, never imported from a "use client" component.
 *
 * `/v1/*` (customer-facing) calls need no auth. `/internal/v1/*` calls send
 * `x-internal-api-key` plus actor headers, same convention as this
 * service's own internal-auth middleware (`src/auth/auth.middleware.ts`
 * in data-product-catalog-service).
 */

export class CatalogServiceError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "CatalogServiceError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

async function catalogServiceFetch<T>(
  path: string,
  options: { internal?: boolean } = {},
): Promise<T> {
  if (!env.catalogServiceEnabled) {
    throw new CatalogServiceError(0, "NOT_CONFIGURED", "CATALOG_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.internal) {
    headers["x-internal-api-key"] = env.catalogServiceInternalApiKey;
    headers["x-actor-type"] = "SERVICE";
    headers["x-actor-id"] = "cdep-portal";
    headers["x-actor-role"] = "CATALOG_READER";
  }

  const response = await fetch(`${env.catalogServiceUrl}${path}`, {
    headers,
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const envelope = json as ErrorEnvelope | undefined;
    throw new CatalogServiceError(
      response.status,
      envelope?.error?.code,
      envelope?.error?.message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return json as T;
}

// --- Customer-facing (/v1/*) — matches GET /v1/data-products/{id} -----------

export interface CatalogSchemaFieldDTO {
  name: string;
  type: string;
  nullable: boolean;
  description: string | null;
  classification: string | null;
  businessKey: boolean;
  grainKey: boolean;
}

export interface CatalogDeliveryMethodDTO {
  type: string;
  formats?: string[];
}

export interface CatalogSlaDTO {
  freshnessMinutes: number | null;
  availabilityTargetPercent: number | null;
  maximumPublicationLatencyMinutes: number | null;
  deliveryDeadlineExpression: string | null;
}

export interface CatalogQualityDTO {
  minimumCompletenessPercent: number | null;
  maximumInvalidPercent: number | null;
  grainUniqueRequired: boolean;
}

export interface CatalogVersionDetailDTO {
  version: string;
  lifecycleStatus: string;
  description: string | null;
  grain: { description: string | null; keys: string[] };
  schema: CatalogSchemaFieldDTO[];
  delivery: CatalogDeliveryMethodDTO[];
  sla: CatalogSlaDTO | null;
  quality: CatalogQualityDTO | null;
  effectiveFrom: string | null;
  deprecatedAt: string | null;
  retiredAt: string | null;
}

export interface CatalogVersionSummaryDTO {
  version: string;
  lifecycleStatus: string;
  effectiveFrom: string | null;
  deprecatedAt: string | null;
  retiredAt: string | null;
}

export interface CatalogProductDetailDTO {
  dataProductId: string;
  name: string;
  description: string | null;
  domain: { id: string; name: string } | null;
  owner: { displayName: string; type: string } | null;
  status: string;
  activeVersion: CatalogVersionDetailDTO | null;
  versionHistory: CatalogVersionSummaryDTO[];
}

export interface CatalogProductSummaryDTO {
  dataProductId: string;
  name: string;
  description: string | null;
  domain: { id: string; name: string } | null;
  status: string;
  activeVersion: string | null;
  lifecycleStatus: string | null;
  supportedDeliveryMethods: CatalogDeliveryMethodDTO[];
  freshnessMinutes: number | null;
}

export function getCatalogProduct(productId: string): Promise<CatalogProductDetailDTO> {
  return catalogServiceFetch<CatalogProductDetailDTO>(`/v1/data-products/${encodeURIComponent(productId)}`);
}

export function listCatalogProducts(params: { search?: string; domain?: string } = {}): Promise<{
  items: CatalogProductSummaryDTO[];
  nextCursor: string | null;
}> {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  if (params.domain) search.set("domain", params.domain);
  const qs = search.toString();
  return catalogServiceFetch(`/v1/data-products${qs ? `?${qs}` : ""}`);
}

// --- Internal (/internal/v1/*) — for future server-to-server use ------------

export interface CatalogActiveVersionDTO {
  dataProductId: string;
  version: string;
  contractVersion: string;
  status: string;
}

export function getCatalogActiveVersion(productId: string): Promise<CatalogActiveVersionDTO> {
  return catalogServiceFetch<CatalogActiveVersionDTO>(
    `/internal/v1/data-products/${encodeURIComponent(productId)}/active-version`,
    { internal: true },
  );
}
