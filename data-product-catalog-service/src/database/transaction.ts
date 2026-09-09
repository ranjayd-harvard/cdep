import type pg from "pg";
import { pool } from "./pool.js";

// Runs `fn` inside a single PostgreSQL transaction. Registration writes
// product/version/schema/policies/contract/event rows together (spec §58/
// §59) — if any step fails, the whole registration rolls back rather than
// leaving a partially-registered product.
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
