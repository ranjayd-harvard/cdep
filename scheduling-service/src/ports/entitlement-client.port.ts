// Port for entitlement revalidation (AGENTS.md section 26/50). Entitlement
// lives inside subscription-service in this platform, but the Scheduler
// talks to it through its own narrow port so the dependency is swappable
// if entitlement is ever split into a standalone service.
export interface EntitlementDecisionResult {
  decision: "ALLOW" | "DENY";
  reason: string;
  entitlementId: string | null;
}

export interface EntitlementClient {
  evaluate(organizationId: string, tenantId: string, dataProductId: string): Promise<EntitlementDecisionResult>;
}
