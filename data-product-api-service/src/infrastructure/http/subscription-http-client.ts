import type { DeliveryContext, SubscriptionClient } from "../../ports/subscription-client.port.js";
import { subscriptionServiceFetch } from "./subscription-service-fetch.js";

interface DeliveryContextWire {
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  status: string;
  resolved_product_version: { version: string; lifecycle_status: string } | null;
  delivery: { method: string };
}

// HTTP implementation of SubscriptionClient — talks only to
// subscription-service's Phase-8-facing
// GET /internal/v1/subscriptions/resolve (spec §8.6).
export class SubscriptionHttpClient implements SubscriptionClient {
  async resolveForScope(organizationId: string, tenantId: string, dataProductId: string): Promise<DeliveryContext | null> {
    const { status, json } = await subscriptionServiceFetch<DeliveryContextWire>(
      `/internal/v1/subscriptions/resolve?organization_id=${encodeURIComponent(organizationId)}&tenant_id=${encodeURIComponent(tenantId)}&data_product_id=${encodeURIComponent(dataProductId)}`,
    );
    if (status === 404 || !json) return null;

    return {
      subscriptionId: json.subscription_id,
      organizationId: json.organization_id,
      tenantId: json.tenant_id,
      dataProductId: json.data_product_id,
      status: json.status,
      resolvedProductVersion: json.resolved_product_version
        ? { version: json.resolved_product_version.version, lifecycleStatus: json.resolved_product_version.lifecycle_status }
        : null,
      deliveryMethod: json.delivery.method,
    };
  }
}
