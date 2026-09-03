import type { DataProduct } from "@/models";
import type { DataProductService } from "@/services/interfaces";
import { getEntitledDataProductIds, isEntitled } from "@/lib/entitlement-directory";
import { findDataProductById, findDataProductsByIds } from "@/lib/data-product-directory";

/**
 * Entitlement enforcement for Data Products, in one place. A tenant
 * only ever sees the Data Products `getEntitledDataProductIds` (backed by
 * `TenantScopedCollection`) says they're entitled to — the catalog lookup
 * itself is shared/unscoped, so this is the only gate.
 */
export class MongoDataProductService implements DataProductService {
  async getDataProducts(tenantId: string): Promise<DataProduct[]> {
    const dataProductIds = await getEntitledDataProductIds(tenantId);
    return findDataProductsByIds(dataProductIds);
  }

  async getDataProduct(tenantId: string, dataProductId: string): Promise<DataProduct | null> {
    const entitled = await isEntitled(tenantId, dataProductId);
    if (!entitled) {
      return null;
    }
    return findDataProductById(dataProductId);
  }
}
