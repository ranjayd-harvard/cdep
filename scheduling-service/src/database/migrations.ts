import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { logger } from "../common/logger/logger.js";

const MIGRATIONS_TABLE = "scheduling_schema_migrations";

// Resolves the migrations/ directory relative to a caller's __dirname —
// same two-depth trick as subscription-service (tsx in dev vs. compiled
// dist/scripts in the Docker image).
export function resolveMigrationsDir(callerDirname: string): string {
  const candidates = [
    path.join(callerDirname, "..", "migrations"),
    path.join(callerDirname, "..", "..", "migrations"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Could not locate migrations directory. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.${MIGRATIONS_TABLE} (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(pool: pg.Pool, migrationsDir: string): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await ensureMigrationsTable(client);

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ filename: string }>(
      `SELECT filename FROM public.${MIGRATIONS_TABLE}`,
    );
    const alreadyApplied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      logger.info({ migration: file }, "Applying migration");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO public.${MIGRATIONS_TABLE} (filename) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
