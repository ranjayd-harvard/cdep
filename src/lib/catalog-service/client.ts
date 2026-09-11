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
  // Phase 10 §22/§28: only VERSION_NOT_RETIRABLE responses carry this —
  // the structured retirement-blocker list.
  readonly blockers: Array<{ type: string; detail: string; count?: number }> | undefined;

  constructor(status: number, code: string | undefined, message: string, blockers?: Array<{ type: string; detail: string; count?: number }>) {
    super(message);
    this.name = "CatalogServiceError";
    this.status = status;
    this.code = code;
    this.blockers = blockers;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string; blockers?: Array<{ type: string; detail: string; count?: number }> };
}

async function catalogServiceFetch<T>(
  path: string,
  options: {
    internal?: boolean;
    method?: "GET" | "POST";
    body?: unknown;
    // Phase 10 admin console (SUPERUSER-gated, /admin/catalog): mutating
    // calls identify the actual admin as the actor and use PLATFORM_ADMIN
    // (the one role every internal route accepts, per this service's own
    // requireInternalAuth — this surface is already gated upstream by
    // requireSuperuserContext, so there is no narrower role to pick here).
    actorEmail?: string;
    role?: string;
  } = {},
): Promise<T> {
  if (!env.catalogServiceEnabled) {
    throw new CatalogServiceError(0, "NOT_CONFIGURED", "CATALOG_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.internal) {
    headers["x-internal-api-key"] = env.catalogServiceInternalApiKey;
    headers["x-actor-type"] = options.actorEmail ? "USER" : "SERVICE";
    headers["x-actor-id"] = options.actorEmail ?? "cdep-portal";
    headers["x-actor-role"] = options.role ?? "CATALOG_READER";
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.catalogServiceUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
      envelope?.error?.blockers,
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

// --- Phase 10 admin console (/admin/catalog) — full internal lifecycle -----

export interface CatalogInternalVersionDTO {
  version: string;
  lifecycle_status: string;
  compatibility_type: string;
  breaking_change: boolean;
  migration_required: boolean;
  predecessor_version: string | null;
  successor_version: string | null;
  grace_period_end: string | null;
  activated_at: string | null;
  effective_from: string | null;
  deprecated_at: string | null;
  retired_at: string | null;
  created_at: string;
}

export function listAllCatalogVersions(productId: string): Promise<{ items: CatalogInternalVersionDTO[] }> {
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/versions`, { internal: true });
}

export interface CatalogMigrationDTO {
  migration_id: string;
  data_product_id: string;
  from_version: string;
  to_version: string;
  compatibility: string;
  status: string;
  start_at: string | null;
  deadline: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogImpactDTO {
  data_product_id: string;
  from_version: string;
  to_version: string;
  subscriber_count: number;
  automatically_compatible: number;
  resolves_to_to: number;
  pinned: number;
  beta_opt_in: number;
  requires_explicit_migration: number;
}

function lifecycleAction(
  productId: string,
  version: string,
  action: string,
  actorEmail: string,
  body?: Record<string, unknown>,
): Promise<{ dataProductId: string; version: string; lifecycleStatus: string }> {
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(version)}/${action}`, {
    internal: true,
    method: "POST",
    body: body ?? {},
    actorEmail,
    role: "PLATFORM_ADMIN",
  });
}

export function activateCatalogVersion(productId: string, version: string, targetStatus: "ACTIVE" | "BETA", actorEmail: string) {
  return lifecycleAction(productId, version, "activate", actorEmail, { targetStatus });
}

export function deprecateCatalogVersion(
  productId: string,
  version: string,
  input: { reason?: string; gracePeriodDays?: number; replacementVersion?: string },
  actorEmail: string,
) {
  return lifecycleAction(productId, version, "deprecate", actorEmail, input);
}

export function retireCatalogVersion(productId: string, version: string, input: { reason?: string; force?: boolean }, actorEmail: string) {
  return lifecycleAction(productId, version, "retire", actorEmail, input);
}

export function rollbackCatalogVersion(productId: string, version: string, reason: string | undefined, actorEmail: string) {
  return lifecycleAction(productId, version, "rollback", actorEmail, { reason });
}

export function approveCatalogVersion(
  productId: string,
  version: string,
  reason: string | undefined,
  actorEmail: string,
): Promise<{ approval_id: string; required: boolean; compatibility_level: string }> {
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(version)}/approve`, {
    internal: true,
    method: "POST",
    body: { reason },
    actorEmail,
    role: "PLATFORM_ADMIN",
  });
}

export function grantCatalogBetaOptIn(
  productId: string,
  version: string,
  input: { organizationId: string; tenantId: string },
  actorEmail: string,
): Promise<{ beta_opt_in_id: string }> {
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(version)}/beta-opt-in`, {
    internal: true,
    method: "POST",
    body: { organizationId: input.organizationId, tenantId: input.tenantId },
    actorEmail,
    role: "PLATFORM_ADMIN",
  });
}

export function getCatalogImpact(productId: string, version: string, against?: string): Promise<CatalogImpactDTO> {
  const qs = against ? `?against=${encodeURIComponent(against)}` : "";
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(version)}/impact${qs}`, {
    internal: true,
  });
}

export function listCatalogMigrations(productId: string): Promise<{ items: CatalogMigrationDTO[] }> {
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/migrations`, { internal: true });
}

export function createCatalogMigration(
  productId: string,
  input: { toVersion: string; reason?: string; deadline?: string },
  actorEmail: string,
): Promise<CatalogMigrationDTO & { affected_subscriptions: number }> {
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/migrations`, {
    internal: true,
    method: "POST",
    body: input,
    actorEmail,
    role: "PLATFORM_ADMIN",
  });
}

export function executeCatalogMigration(
  productId: string,
  migrationId: string,
  actorEmail: string,
): Promise<CatalogMigrationDTO & { results: Array<{ subscriptionId: string; status: string }> }> {
  return catalogServiceFetch(`/internal/v1/data-products/${encodeURIComponent(productId)}/migrations/${encodeURIComponent(migrationId)}/execute`, {
    internal: true,
    method: "POST",
    body: {},
    actorEmail,
    role: "PLATFORM_ADMIN",
  });
}
