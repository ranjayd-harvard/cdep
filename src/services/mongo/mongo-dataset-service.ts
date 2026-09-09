import type { Dataset } from "@/models";
import type { DatasetInput, DatasetService } from "@/services/interfaces";
import { getEntitledDataProductIds, isEntitledToAny } from "@/lib/entitlement-directory";
import {
  associateDataset,
  dissociateAllForDataset,
  dissociateDataset,
  listDataProductIdsForDataset,
  listDatasetIdsForDataProducts,
} from "@/lib/data-product-dataset-directory";
import {
  createDataset,
  deleteDataset,
  findDatasetById,
  findDatasetsByIds,
  listDatasets,
  updateDataset,
} from "@/lib/dataset-directory";

/**
 * Entitlement enforcement for Datasets. A Dataset can be associated with
 * several Data Products (see `src/lib/data-product-dataset-directory.ts`),
 * so visibility is "entitled to at least one of them," not a single
 * `dataProductId` check. `getDataset` returns `null` for a dataset that
 * exists but belongs to no Data Product this tenant is entitled to — the
 * same not-found shape the page already uses via `notFound()` for a
 * dataset id that doesn't exist at all, so guessing another tenant's
 * dataset id confirms nothing.
 */
export class MongoDatasetService implements DatasetService {
  async getDatasets(tenantId: string): Promise<Dataset[]> {
    const dataProductIds = await getEntitledDataProductIds(tenantId);
    const datasetIdsByProduct = await listDatasetIdsForDataProducts(dataProductIds);
    const datasetIds = new Set<string>();
    for (const ids of datasetIdsByProduct.values()) {
      for (const id of ids) {
        datasetIds.add(id);
      }
    }
    return findDatasetsByIds([...datasetIds]);
  }

  async getDataset(tenantId: string, datasetId: string): Promise<Dataset | null> {
    const dataset = await findDatasetById(datasetId);
    if (!dataset) {
      return null;
    }
    const dataProductIds = await listDataProductIdsForDataset(datasetId);
    const entitled = await isEntitledToAny(tenantId, dataProductIds);
    return entitled ? dataset : null;
  }

  listDatasetsByDataProduct(dataProductId: string): Promise<Dataset[]> {
    return listDatasetIdsForDataProducts([dataProductId]).then((byProduct) =>
      findDatasetsByIds(byProduct.get(dataProductId) ?? []),
    );
  }

  listAllDatasets(): Promise<Dataset[]> {
    return listDatasets();
  }

  listDataProductIdsForDataset(datasetId: string): Promise<string[]> {
    return listDataProductIdsForDataset(datasetId);
  }

  createDataset(input: DatasetInput): Promise<Dataset> {
    return createDataset(input);
  }

  updateDataset(datasetId: string, input: DatasetInput): Promise<Dataset | null> {
    return updateDataset(datasetId, input);
  }

  async deleteDataset(datasetId: string): Promise<void> {
    await dissociateAllForDataset(datasetId);
    await deleteDataset(datasetId);
  }

  associateDataset(dataProductId: string, datasetId: string): Promise<void> {
    return associateDataset(dataProductId, datasetId);
  }

  dissociateDataset(dataProductId: string, datasetId: string): Promise<void> {
    return dissociateDataset(dataProductId, datasetId);
  }
}
