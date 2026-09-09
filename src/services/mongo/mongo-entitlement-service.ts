import { EntitlementStatus, type Entitlement } from "@/models";
import type { EntitlementService } from "@/services/interfaces";
import {
  createEntitlement,
  getEntitlements,
  listEntitlementsForDataProduct,
  setEntitlementExpiry,
  setEntitlementStatus,
} from "@/lib/entitlement-directory";
import { listDatasetIdsForDataProduct } from "@/lib/data-product-dataset-directory";
import { syncDatasetEntitlementsForTenant } from "@/lib/exchange-service/catalog-sync";

/**
 * The entitlement fanout to data-exchange-service (real-time push, see
 * `catalog-sync.ts`) lives here rather than in `entitlement-directory.ts`
 * itself: it needs `data-product-dataset-directory.ts` to resolve which
 * datasets a Data Product's grant applies to, and that module already
 * imports *this* service's sibling directory (`entitlement-directory.ts`)
 * the other way, to look up who's entitled when a dataset gets linked —
 * putting the fanout at this (higher) layer avoids a directory-to-directory
 * import cycle.
 */
async function syncEntitlement(tenantId: string, dataProductId: string, entitled: boolean): Promise<void> {
  const datasetIds = await listDatasetIdsForDataProduct(dataProductId);
  await syncDatasetEntitlementsForTenant(tenantId, datasetIds, entitled);
}

export class MongoEntitlementService implements EntitlementService {
  getEntitlements(tenantId: string): Promise<Entitlement[]> {
    return getEntitlements(tenantId);
  }

  async grantEntitlement(
    tenantId: string,
    dataProductId: string,
    grantedBy: string,
    expiresAt: string | null = null,
  ): Promise<Entitlement> {
    const entitlement = await createEntitlement(tenantId, dataProductId, grantedBy, expiresAt);
    await syncEntitlement(tenantId, dataProductId, true);
    return entitlement;
  }

  async revokeEntitlement(tenantId: string, entitlementId: string): Promise<void> {
    const dataProductId = await this.findDataProductIdForEntitlement(tenantId, entitlementId);
    await setEntitlementStatus(tenantId, entitlementId, EntitlementStatus.REVOKED);
    if (dataProductId) await syncEntitlement(tenantId, dataProductId, false);
  }

  async reactivateEntitlement(tenantId: string, entitlementId: string): Promise<void> {
    const dataProductId = await this.findDataProductIdForEntitlement(tenantId, entitlementId);
    await setEntitlementStatus(tenantId, entitlementId, EntitlementStatus.ACTIVE);
    if (dataProductId) await syncEntitlement(tenantId, dataProductId, true);
  }

  private async findDataProductIdForEntitlement(tenantId: string, entitlementId: string): Promise<string | null> {
    const entitlements = await getEntitlements(tenantId);
    return entitlements.find((entitlement) => entitlement.id === entitlementId)?.dataProductId ?? null;
  }

  setEntitlementExpiry(tenantId: string, entitlementId: string, expiresAt: string | null): Promise<void> {
    return setEntitlementExpiry(tenantId, entitlementId, expiresAt);
  }

  listEntitlementsForDataProduct(dataProductId: string): Promise<Entitlement[]> {
    return listEntitlementsForDataProduct(dataProductId);
  }
}
