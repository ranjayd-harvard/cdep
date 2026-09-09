/**
 * The join between a Data Product and a Dataset: a Dataset is a reusable
 * catalog asset that may be used by more than one Data Product, and a
 * Data Product is composed of one or more Datasets. Neither `DataProduct`
 * nor `Dataset` carries a reference to the other directly — this is the
 * only place that association is recorded.
 */
export interface DataProductDataset {
  id: string;
  dataProductId: string;
  datasetId: string;
  createdAt: string;
}
