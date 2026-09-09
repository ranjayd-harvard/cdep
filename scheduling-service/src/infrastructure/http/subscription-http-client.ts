import type {
  SchedulableSubscription,
  SchedulableSubscriptionPage,
  SubscriptionClient,
  SubscriptionDeliveryContext,
} from "../../ports/subscription-client.port.js";
import { subscriptionServiceFetch } from "./subscription-service-fetch.js";

interface DeliveryWire {
  method: string;
  format: string | null;
  frequency: string;
  delivery_time: string | null;
  timezone: string | null;
  retention_days: number | null;
  api_profile: string | null;
  day_of_week: string | null;
  cron_expression: string | null;
}

interface DeliveryContextWire {
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  status: string;
  version_policy: { type: string; value: string | null };
  resolved_product_version: { version: string; version_id?: string } | null;
  delivery: DeliveryWire;
}

interface SubscriptionWire {
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  status: string;
  version_policy: { type: string; value: string | null };
  delivery: DeliveryWire;
  version: number;
}

function mapDelivery(wire: DeliveryWire) {
  return {
    method: wire.method,
    format: wire.format,
    frequency: wire.frequency,
    deliveryTime: wire.delivery_time,
    timezone: wire.timezone,
    retentionDays: wire.retention_days,
    apiProfile: wire.api_profile,
    dayOfWeek: wire.day_of_week,
    cronExpression: wire.cron_expression,
  };
}

// HTTP implementation of SubscriptionClient (AGENTS.md section 48) — talks
// only to subscription-service's /internal/v1/subscriptions/* API, never
// its database. Subscription Service remains authoritative; this client
// fetches fresh on every call, never caches beyond the caller's own
// request scope.
export class SubscriptionHttpClient implements SubscriptionClient {
  async getDeliveryContext(subscriptionId: string): Promise<SubscriptionDeliveryContext | null> {
    const { status, json } = await subscriptionServiceFetch<DeliveryContextWire>(
      `/internal/v1/subscriptions/${encodeURIComponent(subscriptionId)}/delivery-context`,
    );
    if (status === 404 || !json) return null;

    return {
      subscriptionId: json.subscription_id,
      organizationId: json.organization_id,
      tenantId: json.tenant_id,
      dataProductId: json.data_product_id,
      status: json.status,
      versionPolicy: json.version_policy,
      resolvedProductVersion: json.resolved_product_version
        ? { version: json.resolved_product_version.version, lifecycleStatus: "" }
        : null,
      delivery: mapDelivery(json.delivery),
    };
  }

  async listSchedulableSubscriptions(params: { limit?: number; offset?: number }): Promise<SchedulableSubscriptionPage> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));

    const { json } = await subscriptionServiceFetch<{ items: SubscriptionWire[]; has_more: boolean }>(
      `/internal/v1/subscriptions/delivery-candidates?${query.toString()}`,
    );
    const items: SchedulableSubscription[] = (json?.items ?? []).map((w) => ({
      subscriptionId: w.subscription_id,
      organizationId: w.organization_id,
      tenantId: w.tenant_id,
      dataProductId: w.data_product_id,
      status: w.status,
      versionPolicy: w.version_policy,
      delivery: mapDelivery(w.delivery),
      revision: w.version,
    }));
    return { items, hasMore: json?.has_more ?? false };
  }
}
