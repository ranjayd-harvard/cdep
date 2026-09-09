import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../../database/pool.js";
import { resolveMigrationsDir, runMigrations } from "../../database/migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function ensureMigrated(): Promise<void> {
  const migrationsDir = resolveMigrationsDir(path.join(__dirname, ".."));
  await runMigrations(pool, migrationsDir);
}

// Truncates every Phase 6 table between tests so each test starts from a
// clean slate without dropping/recreating the schema each time.
export async function truncateAll(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      subscription_audit_events,
      idempotency_records,
      subscription_delivery_preferences,
      subscriptions,
      entitlements
    RESTART IDENTITY CASCADE
  `);
}
