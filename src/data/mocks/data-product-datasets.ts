import type { DataProductDataset } from "@/models";

/**
 * Seed fixtures for the `dataProductDatasets` join collection (see
 * `scripts/seed-catalog.ts`) — the many-to-many link between Data Products
 * and Datasets. `ds-location-master` is deliberately associated with two
 * Data Products, demonstrating the "one Dataset reused across several
 * Data Products" relationship the rest of the catalog fixtures don't
 * otherwise show.
 */
export const MOCK_DATA_PRODUCT_DATASETS: DataProductDataset[] = [
  {
    id: "dpd-customer-insights-customer-360",
    dataProductId: "dp-customer-insights",
    datasetId: "ds-customer-360",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-customer-insights-transaction-detail",
    dataProductId: "dp-customer-insights",
    datasetId: "ds-transaction-detail",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-events-operations-event-performance",
    dataProductId: "dp-events-operations",
    datasetId: "ds-event-performance",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-events-operations-venue-activity",
    dataProductId: "dp-events-operations",
    datasetId: "ds-venue-activity",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-events-operations-inventory-availability",
    dataProductId: "dp-events-operations",
    datasetId: "ds-inventory-availability",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-commerce-finance-product-catalog",
    dataProductId: "dp-commerce-finance",
    datasetId: "ds-product-catalog",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-commerce-finance-settlement-summary",
    dataProductId: "dp-commerce-finance",
    datasetId: "ds-settlement-summary",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-commerce-finance-location-master",
    dataProductId: "dp-commerce-finance",
    datasetId: "ds-location-master",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "dpd-events-operations-location-master",
    dataProductId: "dp-events-operations",
    datasetId: "ds-location-master",
    createdAt: "2026-01-01T00:00:00Z",
  },
];
