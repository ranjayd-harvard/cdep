import { EntitlementStatus, type Entitlement } from "@/models";
import type { EntitlementService } from "@/services/interfaces";
import { createEntitlement, getEntitlements, setEntitlementStatus } from "@/lib/entitlement-directory";

export class MongoEntitlementService implements EntitlementService {
  getEntitlements(tenantId: string): Promise<Entitlement[]> {
    return getEntitlements(tenantId);
  }

  grantEntitlement(tenantId: string, dataProductId: string, grantedBy: string): Promise<Entitlement> {
    return createEntitlement(tenantId, dataProductId, grantedBy);
  }

  revokeEntitlement(tenantId: string, entitlementId: string): Promise<void> {
    return setEntitlementStatus(tenantId, entitlementId, EntitlementStatus.REVOKED);
  }

  reactivateEntitlement(tenantId: string, entitlementId: string): Promise<void> {
    return setEntitlementStatus(tenantId, entitlementId, EntitlementStatus.ACTIVE);
  }
}
