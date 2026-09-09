import type { EntitlementClient, EntitlementDecisionResult } from "../../ports/entitlement-client.port.js";
import { subscriptionServiceFetch } from "./subscription-service-fetch.js";

interface EntitlementDecisionWire {
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  decision: "ALLOW" | "DENY";
  entitlement_id: string | null;
  reason: string;
  evaluated_at: string;
}

export class EntitlementHttpClient implements EntitlementClient {
  async evaluate(organizationId: string, tenantId: string, dataProductId: string): Promise<EntitlementDecisionResult> {
    const { json } = await subscriptionServiceFetch<EntitlementDecisionWire>("/internal/v1/entitlements/evaluate", {
      method: "POST",
      body: { organization_id: organizationId, tenant_id: tenantId, data_product_id: dataProductId },
    });
    if (!json) {
      return { decision: "DENY", reason: "NO_ENTITLEMENT", entitlementId: null };
    }
    return { decision: json.decision, reason: json.reason, entitlementId: json.entitlement_id };
  }
}
