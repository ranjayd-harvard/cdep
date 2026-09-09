import type { Entitlement } from "@/models";

export interface EntitlementService {
  getEntitlements(tenantId: string): Promise<Entitlement[]>;
  grantEntitlement(
    tenantId: string,
    dataProductId: string,
    grantedBy: string,
    expiresAt?: string | null,
  ): Promise<Entitlement>;
  revokeEntitlement(tenantId: string, entitlementId: string): Promise<void>;
  reactivateEntitlement(tenantId: string, entitlementId: string): Promise<void>;
  setEntitlementExpiry(tenantId: string, entitlementId: string, expiresAt: string | null): Promise<void>;

  /** Admin Console only: every Entitlement across every tenant for one Data Product. */
  listEntitlementsForDataProduct(dataProductId: string): Promise<Entitlement[]>;
}
