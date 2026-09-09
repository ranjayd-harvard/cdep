import type { ProductQuery } from "../domain/product-query.js";

// Internal shape read back from the serving store — deliberately carries
// only the columns this service's response projector knows how to expose
// (spec §8.9), never the full serving row (organization_id/tenant_id/
// lineage columns never leave PostgresServingStore).
export interface ServingEventRow {
  eventId: string;
  venueId: string;
  eventDate: string;
  ticketsSold: number | null;
  grossRevenue: string | null;
  revenuePerTicket: string | null;
}

export interface ServingQueryResult {
  rows: ServingEventRow[];
  hasMore: boolean;
  lastRowSortValues: string[] | null;
  servingSnapshotId: string | null;
}

// Replaceable abstraction (spec §8.1/§8.12/§8.20): swapping PostgresServingStore
// for ClickHouse/BigQuery/Snowflake/etc. later means implementing this one
// interface, never touching the customer-facing API contract, the query
// engine, cursor design, or response projector.
export interface ServingStore {
  queryEventPerformanceEvents(query: ProductQuery): Promise<ServingQueryResult>;
}
