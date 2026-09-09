import { DependencyError } from "../../common/errors/dependency-error.js";
import { env } from "../../config/env.js";

// Shared fetch helper for both SubscriptionHttpClient and
// EntitlementHttpClient — both talk to subscription-service's
// /internal/v1/* API with the same internal-API-key + actor-header
// convention every other service in this platform uses.
export async function subscriptionServiceFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: T | undefined }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-key": env.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY,
    "x-actor-type": "SERVICE",
    "x-actor-id": "data-product-api-service",
    "x-actor-role": "DATA_PRODUCT_API_READER",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      response = await fetch(`${env.SUBSCRIPTION_SERVICE_URL}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new DependencyError(`Subscription Service request to ${path} failed: ${(err as Error).message}`, "SUBSCRIPTION");
  }

  const text = await response.text();
  let json: T | undefined;
  try {
    json = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    json = undefined;
  }

  if (response.status >= 500) {
    throw new DependencyError(`Subscription Service returned ${response.status} for ${path}.`, "SUBSCRIPTION");
  }

  return { status: response.status, json };
}
