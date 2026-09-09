import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../../database/pool.js";
import { resolveMigrationsDir, runMigrations } from "../../database/migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function ensureMigrated(): Promise<void> {
  const migrationsDir = resolveMigrationsDir(path.join(__dirname, ".."));
  await runMigrations(pool, migrationsDir);
}

export async function truncateAll(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      scheduler_audit_events,
      scheduler_dead_letter,
      scheduled_execution,
      scheduler_subscription_projection
    RESTART IDENTITY CASCADE
  `);
}
