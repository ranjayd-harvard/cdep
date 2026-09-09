import type pg from "pg";
import { pool } from "./pool.js";

// Runs `fn` inside a single PostgreSQL transaction. Subscription mutations
// write the subscription row, its delivery preference, an audit event, and
// (where applicable) an idempotency record together (spec §41) — if any
// step fails, the whole command rolls back rather than leaving a partial
// mutation visible.
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
