import type pg from "pg";
import { pool } from "./pool.js";

// Runs `fn` inside a single PostgreSQL transaction. Used to keep related
// control-plane writes (e.g. "create exchange" + "append exchange event")
// atomic. Distributed transactions spanning PostgreSQL and object storage
// are deliberately NOT attempted — see AGENTS.md section 54/55. Instead,
// storage writes are designed to be safely retryable and reconciliation
// detects any drift between the two systems after the fact.
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
