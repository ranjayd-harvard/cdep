// Boundary for subscription-service — context enrichment only (org/tenant/
// product/delivery method for a subscription_id), never a stage source.
export interface SubscriptionDeliveryContext {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: string;
  deliveryMethod: "FILE" | "API" | null;
}

export interface SubscriptionClient {
  getDeliveryContext(subscriptionId: string): Promise<SubscriptionDeliveryContext | null>;
}
