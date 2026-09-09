import { env } from "@/config/env";
import type { TenantContext } from "@/lib/tenant";
import { mintDevToken } from "./token";

/**
 * Server-only client for data-exchange-service's control-plane API.
 *
 * Nothing in this file is ever imported by client-side code — it's only
 * reachable via `src/services/exchange-api/*`, which is wired into
 * `src/services/index.ts`, the *server* registry, never
 * `src/services/client.ts`. (Not enforced by the `server-only` package —
 * this repo doesn't depend on it — so keep it that way by convention: if
 * you add an import of this file from a `"use client"` component, that's
 * a bug.) The browser
 * always talks to this app's own `/api/*` routes, never to
 * data-exchange-service directly — see
 * `docs/exchange-service-integration.md` § "Why server-to-server, not
 * browser-to-exchange-service" for the reasoning (CORS/mixed-content
 * aside, it's what keeps the token-minting bridge and the service's
 * network location out of the browser entirely).
 *
 * The one exception, by design, is the signed upload/download URLs this
 * client returns: those DO get handed to the browser (that's the whole
 * point of the presigned-URL architecture — see data-exchange-service's
 * own README), and the browser talks to object storage directly for the
 * actual bytes.
 */

export class ExchangeServiceError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "ExchangeServiceError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

async function exchangeServiceFetch<T>(
  path: string,
  options: { method?: string; context?: TenantContext; body?: unknown; internal?: boolean } = {},
): Promise<T> {
  if (!env.exchangeServiceEnabled) {
    throw new ExchangeServiceError(0, "NOT_CONFIGURED", "EXCHANGE_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.context) {
    headers.Authorization = `Bearer ${mintDevToken(options.context)}`;
  }
  if (options.internal) {
    headers["x-internal-api-key"] = env.exchangeServiceInternalApiKey;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.exchangeServiceUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Server-to-server call within the same request lifecycle — never
    // cache exchange lifecycle data at the fetch layer.
    cache: "no-store",
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const envelope = json as ErrorEnvelope | undefined;
    throw new ExchangeServiceError(
      response.status,
      envelope?.error?.code,
      envelope?.error?.message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// Typed request/response shapes — mirrors data-exchange-service's actual
// API (see that service's README "API surface" table and OpenAPI at
// /docs). Kept minimal: only the fields the portal actually consumes.
// ---------------------------------------------------------------------------

export interface InitiateUploadResponse {
  exchangeId: string;
  status: string;
  upload: { method: "PUT"; url: string; expiresInSeconds: number };
}

export function initiateUpload(
  context: TenantContext,
  input: { dataProductId: string; filename: string; contentType: string; sizeBytes: number; schemaVersion?: string },
): Promise<InitiateUploadResponse> {
  return exchangeServiceFetch<InitiateUploadResponse>("/v1/uploads", { method: "POST", context, body: input });
}

export interface CompleteUploadResponse {
  exchangeId: string;
  status: string;
}

export function completeUpload(context: TenantContext, exchangeId: string): Promise<CompleteUploadResponse> {
  return exchangeServiceFetch<CompleteUploadResponse>(`/v1/uploads/${encodeURIComponent(exchangeId)}/complete`, {
    method: "POST",
    context,
  });
}

export interface ExchangeSummary {
  exchangeId: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  dataProductId: string;
  schemaVersion: string | null;
  recordCount: number | null;
  errorCount: number | null;
  startedAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ListExchangesResponse {
  items: ExchangeSummary[];
  nextCursor: string | null;
}

export function listExchanges(
  context: TenantContext,
  filter: { direction?: "INBOUND" | "OUTBOUND"; status?: string; limit?: number } = {},
): Promise<ListExchangesResponse> {
  const params = new URLSearchParams();
  if (filter.direction) params.set("direction", filter.direction);
  if (filter.status) params.set("status", filter.status);
  params.set("limit", String(filter.limit ?? 100));
  return exchangeServiceFetch<ListExchangesResponse>(`/v1/exchanges?${params.toString()}`, { context });
}

export interface AdminExchangeSummary extends ExchangeSummary {
  organizationId: string;
  tenantId: string;
  filename: string | null;
}

export interface ListExchangesInternalResponse {
  items: AdminExchangeSummary[];
}

/**
 * Superadmin-only, cross-tenant equivalent of listExchanges() above --
 * calls data-exchange-service's /internal/v1/exchanges (requireInternalApiKey,
 * not a tenant JWT; no TenantContext exists to pass here). Used only by
 * `src/services/lakehouse-admin/*` to back the /admin/lakehouse page.
 */
export function listExchangesInternal(
  filter: { direction?: "INBOUND" | "OUTBOUND"; limit?: number } = {},
): Promise<ListExchangesInternalResponse> {
  const params = new URLSearchParams();
  if (filter.direction) params.set("direction", filter.direction);
  params.set("limit", String(filter.limit ?? 100));
  return exchangeServiceFetch<ListExchangesInternalResponse>(
    `/internal/v1/exchanges?${params.toString()}`,
    { internal: true },
  );
}

export interface ExchangeDetail {
  exchangeId: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  dataProduct: { id: string; name: string };
  file: { filename: string; sizeBytes: number; format: string } | null;
  schemaVersion: string | null;
  recordCount: number | null;
  errorCount: number | null;
  startedAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
}

export function getExchange(context: TenantContext, exchangeId: string): Promise<ExchangeDetail> {
  return exchangeServiceFetch<ExchangeDetail>(`/v1/exchanges/${encodeURIComponent(exchangeId)}`, { context });
}

export interface ValidationErrorItem {
  row: number;
  field: string;
  code: string;
}

export interface ValidationResult {
  status: string;
  totalRecords: number | null;
  validRecords: number | null;
  invalidRecords: number | null;
  errors: ValidationErrorItem[];
}

/** Only meaningful for INBOUND exchanges that have run validation. */
export function getExchangeValidation(context: TenantContext, exchangeId: string): Promise<ValidationResult> {
  return exchangeServiceFetch<ValidationResult>(`/v1/exchanges/${encodeURIComponent(exchangeId)}/validation`, { context });
}

export interface DownloadUrlResponse {
  exchangeId: string;
  filename: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

export function requestDownloadUrl(context: TenantContext, exchangeId: string): Promise<DownloadUrlResponse> {
  return exchangeServiceFetch<DownloadUrlResponse>(`/v1/downloads/${encodeURIComponent(exchangeId)}/url`, {
    method: "POST",
    context,
  });
}

export interface PublicationResponse {
  exchangeId: string;
  status: string;
  filename: string;
}

/**
 * Calls the internal-only fixture-publication endpoint — see
 * data-exchange-service's own README § "Outbound Publication". Requires
 * `EXCHANGE_SERVICE_INTERNAL_API_KEY`; used by `ExchangeApiUploadService`
 * to mirror the "processed output becomes available for download" UX the
 * Mongo implementation fakes today. Never called with a caller-supplied
 * `TenantContext` — the internal API key is the only credential, and
 * organization/tenant ids are passed explicitly in the body instead.
 */
export function publishFixture(input: {
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  schemaVersion?: string;
  filename: string;
}): Promise<PublicationResponse> {
  return exchangeServiceFetch<PublicationResponse>("/internal/v1/publications", {
    method: "POST",
    internal: true,
    body: input,
  });
}

export interface PipelineJobResponse {
  jobId: string;
  status: string;
}

/**
 * Enqueues a real Bronze->Silver->Gold->Publish pipeline run for a
 * completed upload — the counterpart to `publishFixture` above, used when
 * `env.demoFixturePublishEnabled` is false. data-exchange-service's own
 * pipeline worker (not this app) decides when to actually run it; this call
 * only durably records that it should happen. Same internal-key-only auth
 * as `publishFixture`.
 */
export function enqueuePipelineJob(input: {
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  exchangeId: string;
}): Promise<PipelineJobResponse> {
  return exchangeServiceFetch<PipelineJobResponse>("/internal/v1/pipeline-jobs", {
    method: "POST",
    internal: true,
    body: input,
  });
}

export interface PipelineJobDTO {
  jobId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  sourceExchangeId: string;
  outboundExchangeId: string | null;
  status: string;
  currentStage: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListPipelineJobsInternalResponse {
  items: PipelineJobDTO[];
}

/**
 * Superadmin-only, cross-tenant list of `exchange.pipeline_jobs` -- calls
 * data-exchange-service's `/internal/v1/pipeline-jobs` (requireInternalApiKey,
 * not a tenant JWT). Used only by `src/services/pipeline-job-admin/*` to
 * back the "Pipeline Queue" tab on `/admin/lakehouse`.
 */
export function listPipelineJobsInternal(
  filter: { status?: string; limit?: number } = {},
): Promise<ListPipelineJobsInternalResponse> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  params.set("limit", String(filter.limit ?? 100));
  return exchangeServiceFetch<ListPipelineJobsInternalResponse>(
    `/internal/v1/pipeline-jobs?${params.toString()}`,
    { internal: true },
  );
}

/**
 * Runs a PENDING job immediately (instead of waiting for the next poll
 * tick), or re-enqueues+runs a FAILED/SUCCEEDED one -- calls
 * data-exchange-service's `/internal/v1/pipeline-jobs/:jobId/run`. Blocks
 * until the whole Bronze->Silver->Gold->Publish chain finishes, same
 * synchronous-trigger shape as `triggerBronzeToSilver`/`triggerPublish` in
 * `src/lib/lakehouse-service/client.ts` / `src/lib/publication-service/client.ts`.
 */
export function runPipelineJobInternal(jobId: string): Promise<PipelineJobDTO> {
  return exchangeServiceFetch<PipelineJobDTO>(`/internal/v1/pipeline-jobs/${encodeURIComponent(jobId)}/run`, {
    method: "POST",
    internal: true,
  });
}

/**
 * Real-time counterparts to `data-exchange-service/scripts/sync-cdep-catalog.ts`
 * — see `src/lib/exchange-service/catalog-sync.ts` for the orchestration
 * that calls these right after a cdep catalog write, and
 * `docs/exchange-service-integration.md` § "Keeping catalogs in sync" for
 * why both this push path and the on-demand script exist. All four are
 * internal-key-protected upserts; nothing here is ever reachable from
 * client-side code.
 */
export function pushOrganization(organizationId: string, displayName: string): Promise<void> {
  return exchangeServiceFetch<void>(`/internal/v1/catalog/organizations/${encodeURIComponent(organizationId)}`, {
    method: "PUT",
    internal: true,
    body: { displayName },
  });
}

export function pushTenant(tenantId: string, organizationId: string, displayName: string): Promise<void> {
  return exchangeServiceFetch<void>(`/internal/v1/catalog/tenants/${encodeURIComponent(tenantId)}`, {
    method: "PUT",
    internal: true,
    body: { organizationId, displayName },
  });
}

export function pushMembership(
  userId: string,
  organizationId: string,
  tenantId: string,
  role: string,
): Promise<void> {
  return exchangeServiceFetch<void>(`/internal/v1/catalog/memberships/${encodeURIComponent(userId)}`, {
    method: "PUT",
    internal: true,
    body: { organizationId, tenantId, role },
  });
}

export function pushDataProduct(
  datasetId: string,
  name: string,
  description: string,
  currentSchemaVersion: string,
): Promise<void> {
  return exchangeServiceFetch<void>(`/internal/v1/catalog/data-products/${encodeURIComponent(datasetId)}`, {
    method: "PUT",
    internal: true,
    body: { name, description, currentSchemaVersion },
  });
}

export function pushEntitlement(
  tenantId: string,
  datasetId: string,
  canUpload: boolean,
  canDownload: boolean,
): Promise<void> {
  return exchangeServiceFetch<void>(
    `/internal/v1/catalog/entitlements/${encodeURIComponent(tenantId)}/${encodeURIComponent(datasetId)}`,
    { method: "PUT", internal: true, body: { canUpload, canDownload } },
  );
}

/**
 * Uploads raw bytes to the signed URL returned by {@link initiateUpload}.
 *
 * `url`'s hostname is whatever data-exchange-service's own
 * `OBJECT_STORAGE_PUBLIC_ENDPOINT` says (typically "localhost:9000" —
 * correct for a real browser, or for this app when it runs via `npm run
 * dev` directly on the host). But this PUT happens here, server-side, as
 * part of the documented upload-proxy tradeoff (see
 * `ExchangeApiUploadService`'s class doc) — and when *this app itself*
 * also runs inside Docker (`docker-compose.yml`), container-internal
 * "localhost" is the container, not the host, so that connection would
 * fail with ECONNREFUSED even though the signed URL is perfectly valid.
 *
 * `EXCHANGE_SERVICE_STORAGE_RELAY_HOST` (server-only, optional — see
 * `docs/exchange-service-integration.md` § "Docker-in-Docker: the
 * storage relay host problem") lets that case work anyway: it redirects
 * the actual TCP connection to a reachable host (typically
 * "host.docker.internal:9000") while an explicit `Host` header keeps the
 * original hostname the URL's SigV4 signature was computed against —
 * changing the connection target without that header would make the
 * signature invalid. Browser-side downloads need no such thing; they
 * only ever go through `requestDownloadUrl`, never this function.
 *
 * Built on `node:http`/`node:https` directly, NOT `fetch` — verified
 * empirically that undici's `fetch` does not actually send a
 * caller-supplied `Host` header override on the wire (silently keeping
 * the connection target's own host instead), which makes MinIO reject
 * the presigned URL's signature with `SignatureDoesNotMatch` even though
 * the header appears to be set. `node:http(s)`'s `request()` does not
 * have that restriction.
 */
export async function putToSignedUrl(url: string, contentType: string, body: Buffer): Promise<void> {
  const target = new URL(url);
  const originalHost = target.host;
  const relayHost = env.exchangeServiceStorageRelayHost;
  const [connectHost, connectPort] = relayHost ? relayHost.split(":") : [target.hostname, target.port];

  const transport = target.protocol === "https:" ? await import("node:https") : await import("node:http");

  await new Promise<void>((resolve, reject) => {
    const req = transport.request(
      {
        host: connectHost,
        port: connectPort || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "PUT",
        headers: {
          Host: originalHost,
          "Content-Type": contentType,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let responseBody = "";
        res.on("data", (chunk: Buffer) => {
          responseBody += chunk.toString("utf8");
        });
        res.on("end", () => {
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            reject(
              new ExchangeServiceError(
                status,
                "STORAGE_PUT_FAILED",
                `Signed upload PUT failed with status ${status}: ${responseBody.slice(0, 500)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", (err) => reject(err));
    req.end(body);
  });
}
