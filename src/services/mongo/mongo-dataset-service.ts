import type { Dataset } from "@/models";
import type { DatasetService } from "@/services/interfaces";
import { getEntitledDataProductIds, isEntitled } from "@/lib/entitlement-directory";
import { findDatasetById, findDatasetsByDataProductIds } from "@/lib/dataset-directory";

/**
 * Entitlement enforcement for Datasets. `getDataset` returns `null` for a
 * dataset that exists but belongs to a Data Product this tenant isn't
 * entitled to — the same not-found shape the page already uses via
 * `notFound()` for a dataset id that doesn't exist at all, so guessing
 * another tenant's dataset id confirms nothing.
 */
export class MongoDatasetService implements DatasetService {
  async getDatasets(tenantId: string): Promise<Dataset[]> {
    const dataProductIds = await getEntitledDataProductIds(tenantId);
    return findDatasetsByDataProductIds(dataProductIds);
  }

  async getDataset(tenantId: string, datasetId: string): Promise<Dataset | null> {
    const dataset = await findDatasetById(datasetId);
    if (!dataset) {
      return null;
    }
    const entitled = await isEntitled(tenantId, dataset.dataProductId);
    return entitled ? dataset : null;
  }
}
