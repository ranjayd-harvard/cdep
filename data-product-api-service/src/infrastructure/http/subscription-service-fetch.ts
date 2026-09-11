import { DependencyError } from "../../common/errors/dependency-error.js";
import { env } from "../../config/env.js";
import { mintServiceToken } from "../../security/service-identity.js";

// Shared fetch helper for both SubscriptionHttpClient and
// EntitlementHttpClient — both talk to subscription-service's
// /internal/v1/* API. The internal-API-key env var now signs a short-lived
// service-identity token (spec §14) rather than being sent as a raw,
// indefinitely-reusable secret.
export async function subscriptionServiceFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: T | undefined }> {
  const serviceToken = await mintServiceToken(env.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY, {
    sub: "data-product-api-service",
    aud: "subscription-service",
    role: "DATA_PRODUCT_API_READER",
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-service-token": serviceToken,
    // Legacy fields, additive only — see subscription-service's
    // internal-auth.middleware.ts migration note.
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
