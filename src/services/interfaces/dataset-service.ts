import type { Dataset } from "@/models";

export type DatasetInput = Omit<Dataset, "id">;

export interface DatasetService {
  getDatasets(tenantId: string): Promise<Dataset[]>;
  getDataset(tenantId: string, datasetId: string): Promise<Dataset | null>;

  /**
   * Admin Console only (`src/app/admin/data-products/[dataProductId]`):
   * every Dataset associated with one Data Product, unfiltered by any
   * tenant's entitlements — same shape as
   * `DataProductService.listAllDataProducts`.
   */
  listDatasetsByDataProduct(dataProductId: string): Promise<Dataset[]>;

  /** Admin Console only: the full catalog, for pickers that associate a Dataset with a Data Product. */
  listAllDatasets(): Promise<Dataset[]>;

  /** Admin Console only: which Data Products a Dataset is currently associated with. */
  listDataProductIdsForDataset(datasetId: string): Promise<string[]>;

  createDataset(input: DatasetInput): Promise<Dataset>;
  updateDataset(datasetId: string, input: DatasetInput): Promise<Dataset | null>;
  deleteDataset(datasetId: string): Promise<void>;

  /** Associates an existing Dataset with a Data Product. Idempotent. */
  associateDataset(dataProductId: string, datasetId: string): Promise<void>;
  /** Removes the association between a Dataset and a Data Product (the Dataset itself is untouched). */
  dissociateDataset(dataProductId: string, datasetId: string): Promise<void>;
}
