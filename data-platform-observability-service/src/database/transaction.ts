import type pg from "pg";
import { pool } from "./pool.js";

// Runs `fn` inside a single PostgreSQL transaction. Callers must never
// perform network calls to sibling services while inside one of these
// transactions — claim-then-commit, call out, then a second short
// transaction to persist the outcome, same discipline as scheduling-service.
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
