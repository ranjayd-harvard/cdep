import { servingStorePool } from "../../database/pool.js";

// Truncates the serving-store tables this service's tests write fixture
// rows into. This service never owns migrations for these tables
// (serving-projection-service does) — it only ever truncates/reads.
export async function truncateServingStore(): Promise<void> {
  await servingStorePool.query(`
    TRUNCATE TABLE api_serving.event_performance_events, api_serving.event_performance_events_staging
  `);
}
