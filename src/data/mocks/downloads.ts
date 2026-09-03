import type { DownloadableFile } from "@/models";

export const MOCK_DOWNLOADS: DownloadableFile[] = [
  { id: "dl-0001", datasetId: "ds-customer-360", filename: "customer_360_export_20260829.parquet", format: "Parquet", generatedAt: "2026-08-29T06:21:40Z", sizeBytes: 5_242_880, expiresAt: "2026-09-12T06:21:40Z" },
  { id: "dl-0002", datasetId: "ds-event-performance", filename: "event_performance_20260830.csv", format: "CSV", generatedAt: "2026-08-30T06:04:12Z", sizeBytes: 245_760, expiresAt: "2026-09-13T06:04:12Z" },
  { id: "dl-0003", datasetId: "ds-venue-activity", filename: "venue_activity_20260828.json", format: "JSON", generatedAt: "2026-08-28T22:32:18Z", sizeBytes: 87_040, expiresAt: "2026-09-11T22:32:18Z" },
  { id: "dl-0004", datasetId: "ds-product-catalog", filename: "product_catalog_20260827.parquet", format: "Parquet", generatedAt: "2026-08-27T14:05:33Z", sizeBytes: 3_145_728, expiresAt: "2026-09-10T14:05:33Z" },
  { id: "dl-0005", datasetId: "ds-settlement-summary", filename: "settlement_summary_wk34.csv", format: "CSV", generatedAt: "2026-08-24T12:03:02Z", sizeBytes: 512_000, expiresAt: "2026-09-07T12:03:02Z" },
  { id: "dl-0006", datasetId: "ds-location-master", filename: "location_master_202608.parquet", format: "Parquet", generatedAt: "2026-08-01T00:02:10Z", sizeBytes: 409_600, expiresAt: "2026-09-01T00:02:10Z" },
  { id: "dl-0007", datasetId: "ds-customer-360", filename: "customer_360_export_20260822.parquet", format: "Parquet", generatedAt: "2026-08-22T06:22:05Z", sizeBytes: 5_500_000, expiresAt: "2026-09-05T06:22:05Z" },
  { id: "dl-0008", datasetId: "ds-inventory-availability", filename: "inventory_availability_20260829.json", format: "JSON", generatedAt: "2026-08-29T09:06:12Z", sizeBytes: 60_000, expiresAt: "2026-09-12T09:06:12Z" },
  { id: "dl-0009", datasetId: "ds-transaction-detail", filename: "transaction_detail_20260810.csv", format: "CSV", generatedAt: "2026-08-10T08:33:47Z", sizeBytes: 970_000, expiresAt: "2026-08-24T08:33:47Z" },
  { id: "dl-0010", datasetId: "ds-venue-activity", filename: "venue_activity_20260821.json", format: "JSON", generatedAt: "2026-08-21T22:31:47Z", sizeBytes: 81_920, expiresAt: "2026-09-04T22:31:47Z" },
];
