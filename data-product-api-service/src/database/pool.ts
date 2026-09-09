import pg from "pg";
import { env } from "../config/env.js";

// node-postgres parses DATE (OID 1082) into a local-midnight JS Date by
// default, which round-trips incorrectly through toISOString() in any
// timezone ahead of UTC (local midnight becomes the previous day in UTC).
// event_date is customer-facing and date-only — return the raw
// 'YYYY-MM-DD' string instead, matching what Postgres actually stored.
pg.types.setTypeParser(1082, (value: string) => value);

// Read-mostly connection to the shared API Serving Store
// (serving-projection-service's Postgres) — this service never runs
// migrations and never writes rows, only parameterized SELECTs.
export const servingStorePool = new pg.Pool({
  connectionString: env.SERVING_STORE_DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await servingStorePool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
