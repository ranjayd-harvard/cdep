import type { Dataset } from "@/models";

export interface DatasetService {
  getDatasets(tenantId: string): Promise<Dataset[]>;
  getDataset(tenantId: string, datasetId: string): Promise<Dataset | null>;
}
