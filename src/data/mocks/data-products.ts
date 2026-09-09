import { DataProductStatus, type DataProduct } from "@/models";

/**
 * Seed fixtures for the `dataProducts` collection (see
 * `scripts/seed-catalog.ts`) — shared catalog content, not scoped to any
 * one customer. Which of these a customer can actually see is decided
 * entirely by their Entitlements (`src/data/mocks/entitlements.ts`).
 */
export const MOCK_DATA_PRODUCTS: DataProduct[] = [
  {
    id: "dp-customer-insights",
    name: "customer_insights",
    displayName: "Customer Insights",
    description: "Golden-record customer profiles and the transactions behind them.",
    domain: "Customer",
    owner: "Customer Data Platform Team",
    status: DataProductStatus.ACTIVE,
  },
  {
    id: "dp-events-operations",
    name: "events_operations",
    displayName: "Events & Operations",
    description: "Event performance, venue activity, and real-time inventory availability.",
    domain: "Events",
    owner: "Events Analytics Team",
    status: DataProductStatus.ACTIVE,
  },
  {
    id: "dp-commerce-finance",
    name: "commerce_finance",
    displayName: "Commerce & Finance",
    description: "Product catalog, settlement summaries, and shared location reference data.",
    domain: "Finance",
    owner: "Finance Data Team",
    status: DataProductStatus.ACTIVE,
  },
];
