import { env } from "@/config/env";
import type { TenantContext } from "@/lib/tenant";
import { mintDevToken } from "@/lib/exchange-service/token";

/**
 * Server-only client for subscription-service's customer-facing API
 * (Phase 6 — entitlement/subscription control plane). Structurally like
 * `src/lib/exchange-service/client.ts`: every call is authenticated as the
 * calling tenant via `mintDevToken()`, the same bearer token
 * data-exchange-service already accepts — subscription-service's
 * `AUTH_MODE=development` bridge decodes the identical
 * `{sub, organization_id, active_tenant_id, role}` payload, so no new
 * bridge or role mapping is needed (see subscription-service/README.md
 * "Security model").
 *
 * Only `/v1/*` (customer) endpoints are called from here — never
 * `/internal/v1/*`, which requires a service-to-service API key the portal
 * has no reason to hold for this integration (entitlement grants/denials
 * are an admin/internal concern, not something this app's UI performs).
 *
 * Never import this from a "use client" component — same convention as
 * every other `*-service/client.ts` in this repo.
 */

export class SubscriptionServiceError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "SubscriptionServiceError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

async function subscriptionServiceFetch<T>(
  path: string,
  context: TenantContext,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!env.subscriptionServiceEnabled) {
    throw new SubscriptionServiceError(0, "NOT_CONFIGURED", "SUBSCRIPTION_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${mintDevToken(context)}`,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.subscriptionServiceUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Server-to-server call within the same request lifecycle — entitlement/
    // subscription state can change from another actor at any time, so
    // this must never be cached at the fetch layer.
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
    throw new SubscriptionServiceError(
      response.status,
      envelope?.error?.code,
      envelope?.error?.message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return json as T;
}

// --- DTOs (wire shapes — see subscription-service/src/api/serializers.ts) ---

export interface EntitlementDecisionDTO {
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  decision: "ALLOW" | "DENY";
  entitlement_id: string | null;
  reason: string;
  evaluated_at: string;
}

export type SubscriptionFrequency = "ON_DEMAND" | "DAILY" | "WEEKLY" | "MONTHLY" | "CRON";
export type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

export interface SubscriptionDeliveryDTO {
  method: "FILE" | "API";
  format: string | null;
  frequency: SubscriptionFrequency;
  delivery_time: string | null;
  timezone: string | null;
  retention_days: number | null;
  api_profile: string | null;
  // Phase 7 (scheduling-service): WEEKLY's target day and CRON's
  // expression. Optional — a subscription missing them for a frequency
  // that needs one simply stays manual-trigger-only.
  day_of_week: DayOfWeek | null;
  cron_expression: string | null;
}

export interface SubscriptionDTO {
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  status: "PENDING" | "ACTIVE" | "PAUSED" | "SUSPENDED" | "CANCELLED";
  version_policy: { type: "EXACT" | "COMPATIBLE_MAJOR" | "LATEST_ACTIVE"; value: string | null };
  delivery: SubscriptionDeliveryDTO;
  requested_at: string;
  activated_at: string | null;
  paused_at: string | null;
  suspended_at: string | null;
  cancelled_at: string | null;
  suspension_reason: string | null;
  cancellation_reason: string | null;
  version: number;
}

export function getEntitlementForProduct(context: TenantContext, dataProductId: string): Promise<EntitlementDecisionDTO> {
  return subscriptionServiceFetch<EntitlementDecisionDTO>(
    `/v1/entitlements/products/${encodeURIComponent(dataProductId)}`,
    context,
  );
}

export function listSubscriptions(context: TenantContext): Promise<SubscriptionDTO[]> {
  return subscriptionServiceFetch<{ items: SubscriptionDTO[] }>("/v1/subscriptions", context).then((page) => page.items);
}

export interface CreateSubscriptionInput {
  data_product_id: string;
  version_policy: string;
  delivery: {
    method: "FILE" | "API";
    format?: string;
    frequency: SubscriptionFrequency;
    delivery_time?: string;
    timezone?: string;
    retention_days?: number;
    api_profile?: string;
    day_of_week?: DayOfWeek;
    cron_expression?: string;
  };
}

export function createSubscription(context: TenantContext, input: CreateSubscriptionInput): Promise<SubscriptionDTO> {
  return subscriptionServiceFetch<SubscriptionDTO>("/v1/subscriptions", context, { method: "POST", body: input });
}

export function pauseSubscription(context: TenantContext, subscriptionId: string): Promise<SubscriptionDTO> {
  return subscriptionServiceFetch<SubscriptionDTO>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/pause`, context, {
    method: "POST",
  });
}

export function resumeSubscription(context: TenantContext, subscriptionId: string): Promise<SubscriptionDTO> {
  return subscriptionServiceFetch<SubscriptionDTO>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/resume`, context, {
    method: "POST",
  });
}

export function cancelSubscription(context: TenantContext, subscriptionId: string): Promise<SubscriptionDTO> {
  return subscriptionServiceFetch<SubscriptionDTO>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, context, {
    method: "POST",
  });
}
