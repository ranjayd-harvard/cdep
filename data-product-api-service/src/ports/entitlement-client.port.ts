export interface EntitlementDecisionResult {
  decision: "ALLOW" | "DENY";
  reason: string;
  entitlementId: string | null;
}

// Entitlement lives inside subscription-service in this platform — same
// boundary scheduling-service already crosses via
// POST /internal/v1/entitlements/evaluate. Always called fresh immediately
// before serving a query, never cached across requests (spec §8.6).
export interface EntitlementClient {
  evaluate(organizationId: string, tenantId: string, dataProductId: string): Promise<EntitlementDecisionResult>;
}
