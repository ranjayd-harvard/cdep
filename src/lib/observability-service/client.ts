import { env } from "@/config/env";
import type { TenantContext } from "@/lib/tenant";
import { mintDevToken } from "@/lib/exchange-service/token";

/**
 * Server-only client for data-platform-observability-service (Phase 9).
 * Two distinct auth modes, mirroring data-exchange-service's own client:
 *
 * - `context` (customer): only `/v1/customer/*` is called this way — the
 *   same dev bearer-token bridge every other `*-service/client.ts` uses.
 * - `internal: true`: only `/internal/v1/*` — gated by `x-internal-api-key`
 *   PLUS `x-actor-type`/`x-actor-id`/`x-actor-role` headers (observability-
 *   service's internal auth requires an actor for its audit trail, unlike
 *   data-exchange-service's key-only internal gate). Used only by
 *   `src/services/observability-admin/*` to back `/admin/observability`.
 *
 * Never import this from a "use client" component.
 */

export class ObservabilityServiceError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "ObservabilityServiceError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

async function observabilityServiceFetch<T>(
  path: string,
  options: { context?: TenantContext; internal?: boolean } = {},
): Promise<T> {
  if (!env.observabilityServiceEnabled) {
    throw new ObservabilityServiceError(0, "NOT_CONFIGURED", "OBSERVABILITY_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.context) {
    headers.Authorization = `Bearer ${mintDevToken(options.context)}`;
  }
  if (options.internal) {
    headers["x-internal-api-key"] = env.observabilityServiceInternalApiKey;
    headers["x-actor-type"] = "SERVICE";
    headers["x-actor-id"] = "cdep-portal";
    headers["x-actor-role"] = "PLATFORM_ADMIN";
  }

  const response = await fetch(`${env.observabilityServiceUrl}${path}`, {
    method: "GET",
    headers,
    // Operational state changes independently of this request — never
    // cached at the fetch layer.
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
    throw new ObservabilityServiceError(
      response.status,
      envelope?.error?.code,
      envelope?.error?.message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return json as T;
}

// --- DTOs (wire shapes — see data-platform-observability-service/src/api/serializers.ts) ---

export interface ProductStatusDTO {
  product: { id: string; version: string };
  status: string;
  freshnessMinutes: number | null;
  lastSuccessfulDeliveryAt: string | null;
  nextScheduledDeliveryAt: string | null;
  sla: { status: string };
}

export function getProductStatus(context: TenantContext, dataProductId: string): Promise<ProductStatusDTO> {
  return observabilityServiceFetch<ProductStatusDTO>(
    `/v1/customer/data-products/${encodeURIComponent(dataProductId)}/status`,
    { context },
  );
}

export interface HealthDTO {
  status: string;
  score: number | null;
  component_scores: Record<string, number> | null;
  execution_id: string | null;
  data_product_id?: string;
  product_version?: string;
}

export function getProductHealthInternal(dataProductId: string, params: { version?: string; tenantId?: string } = {}): Promise<HealthDTO> {
  const query = new URLSearchParams();
  if (params.version) query.set("product_version", params.version);
  if (params.tenantId) query.set("tenant_id", params.tenantId);
  const qs = query.toString();
  return observabilityServiceFetch<HealthDTO>(
    `/internal/v1/operations/data-products/${encodeURIComponent(dataProductId)}/health${qs ? `?${qs}` : ""}`,
    { internal: true },
  );
}

export interface ExecutionDTO {
  execution_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  product_version: string;
  subscription_id: string | null;
  scheduled_run_id: string | null;
  publication_id: string | null;
  outbound_exchange_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  current_stage: string | null;
  overall_status: string;
  technical_sla_status: string;
  business_sla_status: string;
  health_status: string;
  created_at: string;
  updated_at: string;
}

export function listExecutionsInternal(params: {
  dataProductId?: string;
  tenantId?: string;
  status?: string;
  limit?: number;
} = {}): Promise<{ items: ExecutionDTO[]; has_more: boolean }> {
  const query = new URLSearchParams();
  if (params.dataProductId) query.set("data_product_id", params.dataProductId);
  if (params.tenantId) query.set("tenant_id", params.tenantId);
  if (params.status) query.set("status", params.status);
  query.set("limit", String(params.limit ?? 50));
  return observabilityServiceFetch(`/internal/v1/operations/executions?${query.toString()}`, { internal: true });
}

export interface AlertDTO {
  alert_id: string;
  alert_type: string;
  severity: string;
  state: string;
  data_product_id: string;
  product_version: string;
  execution_id: string | null;
  title: string;
  description: string | null;
  opened_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  suppressed_until: string | null;
  incident_id: string | null;
}

export function listAlertsInternal(params: { state?: string; tenantId?: string; limit?: number } = {}): Promise<{ items: AlertDTO[] }> {
  const query = new URLSearchParams();
  if (params.state) query.set("state", params.state);
  if (params.tenantId) query.set("tenant_id", params.tenantId);
  query.set("limit", String(params.limit ?? 100));
  return observabilityServiceFetch(`/internal/v1/operations/alerts?${query.toString()}`, { internal: true });
}

export interface IncidentDTO {
  incident_id: string;
  data_product_id: string;
  product_version: string;
  title: string;
  severity: string;
  state: string;
  opened_at: string;
  resolved_at: string | null;
}

export function listIncidentsInternal(params: { state?: string; tenantId?: string } = {}): Promise<{ items: IncidentDTO[] }> {
  const query = new URLSearchParams();
  if (params.state) query.set("state", params.state);
  if (params.tenantId) query.set("tenant_id", params.tenantId);
  return observabilityServiceFetch(`/internal/v1/operations/incidents?${query.toString()}`, { internal: true });
}
