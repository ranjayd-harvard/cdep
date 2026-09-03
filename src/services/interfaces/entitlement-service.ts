import type { Entitlement } from "@/models";

export interface EntitlementService {
  getEntitlements(tenantId: string): Promise<Entitlement[]>;
  grantEntitlement(tenantId: string, dataProductId: string, grantedBy: string): Promise<Entitlement>;
  revokeEntitlement(tenantId: string, entitlementId: string): Promise<void>;
  reactivateEntitlement(tenantId: string, entitlementId: string): Promise<void>;
}
