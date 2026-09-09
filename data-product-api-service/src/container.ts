// Composition root: the one place concrete infrastructure implementations
// are wired to the ports the query service depends on. Swapping
// PostgresServingStore for a future ClickHouse/BigQuery/Snowflake
// implementation touches only this file (spec §8.1/§8.20).
import { env } from "./config/env.js";
import { servingStorePool } from "./database/pool.js";
import { CatalogHttpClient } from "./infrastructure/http/catalog-http-client.js";
import { SubscriptionHttpClient } from "./infrastructure/http/subscription-http-client.js";
import { EntitlementHttpClient } from "./infrastructure/http/entitlement-http-client.js";
import { PostgresServingStore } from "./infrastructure/persistence/postgres-serving-store.js";
import { InMemoryRateLimiter } from "./infrastructure/rate-limit/in-memory-rate-limiter.js";
import type { EventPerformanceQueryDeps } from "./application/services/event-performance-query.service.js";

export const catalogClient = new CatalogHttpClient();
export const subscriptionClient = new SubscriptionHttpClient();
export const entitlementClient = new EntitlementHttpClient();
export const servingStore = new PostgresServingStore(servingStorePool);
export const rateLimiter = new InMemoryRateLimiter(env.RATE_LIMIT_REQUESTS_PER_MINUTE);

export const eventPerformanceQueryDeps: EventPerformanceQueryDeps = {
  catalogClient,
  entitlementClient,
  subscriptionClient,
  servingStore,
  cursorSigningSecret: env.CURSOR_SIGNING_SECRET,
};
