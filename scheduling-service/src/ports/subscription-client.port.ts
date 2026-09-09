// Port for the Subscription Service integration boundary (AGENTS.md
// section 48). Subscription Service stays authoritative for customer
// configuration — the Scheduler only ever reads it through this interface.
export interface DeliveryConfig {
  method: string;
  format: string | null;
  frequency: string;
  deliveryTime: string | null;
  timezone: string | null;
  retentionDays: number | null;
  apiProfile: string | null;
  dayOfWeek: string | null;
  cronExpression: string | null;
}

export interface SubscriptionDeliveryContext {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: string;
  versionPolicy: { type: string; value: string | null };
  resolvedProductVersion: { version: string; lifecycleStatus: string } | null;
  delivery: DeliveryConfig;
}

export interface SchedulableSubscription {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: string;
  versionPolicy: { type: string; value: string | null };
  delivery: DeliveryConfig;
  revision: number;
}

export interface SchedulableSubscriptionPage {
  items: SchedulableSubscription[];
  hasMore: boolean;
}

export interface SubscriptionClient {
  getDeliveryContext(subscriptionId: string): Promise<SubscriptionDeliveryContext | null>;
  listSchedulableSubscriptions(params: { limit?: number; offset?: number }): Promise<SchedulableSubscriptionPage>;
}
