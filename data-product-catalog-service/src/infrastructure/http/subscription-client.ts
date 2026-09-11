import { AppError } from "../../common/errors/app-error.js";
import { env, subscriptionServiceEnabled } from "../../config/env.js";

// Phase 10 §21 point 1 / §26: the retirement guard and impact-analysis
// service both need "which subscriptions exist for this Data Product,
// and what policy do they carry" — subscription-service remains the
// authoritative owner of that state; Catalog never queries its database
// directly (same discipline as every other cross-service call in this
// repo — HTTP only, denormalized snapshots where persisted).
export class SubscriptionServiceUnavailableError extends AppError {
  constructor(message: string) {
    super("INTERNAL_ERROR", message);
  }
}

export interface SubscriptionCandidateDTO {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: string;
  versionPolicy: { type: string; value: string | null };
}

async function fetchJson<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; role?: string } = {}): Promise<T> {
  if (!subscriptionServiceEnabled) {
    throw new SubscriptionServiceUnavailableError("SUBSCRIPTION_SERVICE_URL is not configured.");
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-key": env.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY,
    "x-actor-type": "SERVICE",
    "x-actor-id": "data-product-catalog-service",
    "x-actor-role": options.role ?? "CATALOG_READER",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.SUBSCRIPTION_SERVICE_TIMEOUT_SECONDS * 1000);
    try {
      response = await fetch(`${env.SUBSCRIPTION_SERVICE_URL}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new SubscriptionServiceUnavailableError(`subscription-service request to ${path} failed: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new SubscriptionServiceUnavailableError(`subscription-service returned ${response.status} for ${path}.`);
  }
  return (await response.json()) as T;
}

// Phase 10 §35: the one system-driven write Catalog performs into
// subscription-service's data — moving a subscription's version policy as
// part of executing a NON_BREAKING migration plan. Catalog never writes
// Subscription's table directly; this calls subscription-service's own
// internal endpoint, same discipline as every other cross-service write.
export async function updateSubscriptionVersionPolicy(subscriptionId: string, exactVersion: string): Promise<void> {
  await fetchJson(`/internal/v1/subscriptions/${encodeURIComponent(subscriptionId)}/version-policy`, {
    method: "POST",
    role: "PLATFORM_ADMIN",
    body: { version_policy: { type: "EXACT", value: exactVersion } },
  });
}

// Pages through delivery-candidates (spec §31) until exhausted. Used for
// active-subscription retirement blocking and impact analysis, both of
// which need the full set, not one page.
export async function listActiveSubscriptionsForProduct(dataProductId: string): Promise<SubscriptionCandidateDTO[]> {
  const items: SubscriptionCandidateDTO[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const page = await fetchJson<{ items: Array<Record<string, unknown>>; has_more: boolean }>(
      `/internal/v1/subscriptions/delivery-candidates?data_product_id=${encodeURIComponent(dataProductId)}&status=ACTIVE&limit=${limit}&offset=${offset}`,
    );
    for (const raw of page.items) {
      items.push({
        subscriptionId: raw.subscription_id as string,
        organizationId: raw.organization_id as string,
        tenantId: raw.tenant_id as string,
        dataProductId: raw.data_product_id as string,
        status: raw.status as string,
        versionPolicy: raw.version_policy as { type: string; value: string | null },
      });
    }
    if (!page.has_more || page.items.length === 0) break;
    offset += limit;
  }
  return items;
}
