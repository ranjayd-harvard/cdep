import { env } from "@/config/env";
import type { TenantContext } from "@/lib/tenant";
import { mintDevToken } from "@/lib/exchange-service/token";

/**
 * Server-only client for scheduling-service's customer-facing API
 * (Phase 7 — decides when a subscribed Data Product publication is due/
 * eligible). Structurally identical to `src/lib/subscription-service/client.ts`:
 * every call is authenticated as the calling tenant via `mintDevToken()`,
 * the same bearer token subscription-service already accepts — scheduling-
 * service's `AUTH_MODE=development` bridge decodes the identical
 * `{sub, organization_id, active_tenant_id, role}` payload.
 *
 * Only `/v1/*` (customer) endpoints are called from here — never
 * `/internal/*`, which requires a service-to-service API key the portal
 * has no reason to hold for this integration.
 *
 * Never import this from a "use client" component — same convention as
 * every other `*-service/client.ts` in this repo.
 */

export class SchedulingServiceError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "SchedulingServiceError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

async function schedulingServiceFetch<T>(
  path: string,
  context: TenantContext,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!env.schedulingServiceEnabled) {
    throw new SchedulingServiceError(0, "NOT_CONFIGURED", "SCHEDULING_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${mintDevToken(context)}`,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.schedulingServiceUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Scheduling state changes independently of this request (background
    // scan ticks, other actors) — never cached at the fetch layer.
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
    throw new SchedulingServiceError(
      response.status,
      envelope?.error?.code,
      envelope?.error?.message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return json as T;
}

// --- DTOs (wire shapes — see scheduling-service/src/api/serializers.ts) ---

export type ExecutionStatus =
  | "PENDING"
  | "EVALUATING"
  | "ELIGIBLE"
  | "DISPATCHING"
  | "SUBMITTED"
  | "RETRY_WAIT"
  | "SKIPPED"
  | "SUCCEEDED"
  | "TERMINAL_FAILED"
  | "DEAD_LETTERED"
  | "CANCELLED";

export interface ScheduleStatusDTO {
  subscription_id: string;
  status: string;
  schedule_mode: "ON_DEMAND" | "DAILY" | "WEEKLY" | "CRON" | null;
  time_zone: string | null;
  next_scheduled_run: string | null;
  last_execution: { execution_id: string; scheduled_for: string; status: ExecutionStatus } | null;
}

export interface ExecutionDTO {
  execution_id: string;
  subscription_id: string;
  data_product_id: string;
  reason: "SCHEDULED" | "MANUAL" | "ON_DEMAND" | "MISSED_RUN_RECOVERY" | "RETRY";
  scheduled_for: string;
  resolved_product_version: string | null;
  delivery_method: string | null;
  format: string | null;
  status: ExecutionStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  publication_id: string | null;
  failure_category: string | null;
  failure_message: string | null;
  ineligibility_reason_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export function getScheduleStatus(context: TenantContext, subscriptionId: string): Promise<ScheduleStatusDTO> {
  return schedulingServiceFetch<ScheduleStatusDTO>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/schedule-status`, context);
}

export function listExecutions(context: TenantContext, subscriptionId: string, limit = 5): Promise<ExecutionDTO[]> {
  return schedulingServiceFetch<{ items: ExecutionDTO[] }>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/executions?limit=${limit}`,
    context,
  ).then((page) => page.items);
}

export function triggerPublication(context: TenantContext, subscriptionId: string): Promise<ExecutionDTO> {
  return schedulingServiceFetch<ExecutionDTO>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/publications`, context, {
    method: "POST",
  });
}
