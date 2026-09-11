import { DependencyError } from "../../common/errors/dependency-error.js";
import { env, subscriptionServiceEnabled } from "../../config/env.js";
import { mintServiceToken } from "../../security/service-identity.js";
import type { SubscriptionClient, SubscriptionDeliveryContext } from "../../ports/subscription-client.port.js";

interface DeliveryContextWire {
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  status: string;
  delivery: { method: "FILE" | "API" | null };
}

export class SubscriptionHttpClient implements SubscriptionClient {
  async getDeliveryContext(subscriptionId: string): Promise<SubscriptionDeliveryContext | null> {
    if (!subscriptionServiceEnabled) return null;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.SUBSCRIPTION_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        // Least privilege (spec §14): a read-only status lookup asserts
        // "SERVICE", not PLATFORM_ADMIN — the role is now inside a signed,
        // short-lived token (service-identity.ts), not a plaintext header,
        // so there's no reason to over-claim it either.
        const serviceToken = await mintServiceToken(env.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY, {
          sub: "data-platform-observability-service",
          aud: "subscription-service",
          role: "SERVICE",
        });
        response = await fetch(
          `${env.SUBSCRIPTION_SERVICE_URL}/internal/v1/subscriptions/${encodeURIComponent(subscriptionId)}/delivery-context`,
          {
            headers: {
              Accept: "application/json",
              "x-service-token": serviceToken,
              // Legacy fields, additive only — see subscription-service's
              // internal-auth.middleware.ts migration note. Kept minimal
              // ("SERVICE", not PLATFORM_ADMIN) even on this fallback path.
              "x-internal-api-key": env.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY,
              "x-actor-type": "SERVICE",
              "x-actor-id": "data-platform-observability-service",
              "x-actor-role": "SERVICE",
            },
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Subscription Service request failed: ${(err as Error).message}`, "SUBSCRIPTION", true);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new DependencyError(`Subscription Service returned ${response.status}.`, "SUBSCRIPTION", response.status >= 500);
    }

    const body = (await response.json()) as DeliveryContextWire;
    return {
      subscriptionId: body.subscription_id,
      organizationId: body.organization_id,
      tenantId: body.tenant_id,
      dataProductId: body.data_product_id,
      status: body.status,
      deliveryMethod: body.delivery?.method ?? null,
    };
  }
}
