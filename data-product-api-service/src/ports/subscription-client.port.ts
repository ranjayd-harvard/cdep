export interface ResolvedProductVersion {
  version: string;
  lifecycleStatus: string;
}

export interface DeliveryContext {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: string;
  resolvedProductVersion: ResolvedProductVersion | null;
  deliveryMethod: string;
}

// Port for the Subscription Service integration boundary (spec §8.1/§8.6).
// Subscription Service stays authoritative for subscription status,
// version-policy resolution, and delivery-method configuration — this
// service only ever reads it fresh, per request.
export interface SubscriptionClient {
  resolveForScope(organizationId: string, tenantId: string, dataProductId: string): Promise<DeliveryContext | null>;
}
