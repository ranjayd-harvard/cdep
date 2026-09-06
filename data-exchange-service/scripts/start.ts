// Container entrypoint: run pending migrations, then start the HTTP server.
// Kept as a plain sequential script rather than a scheduler/orchestrator —
// this is a one-shot "apply schema, then boot" step, not a recurring job.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/database/pool.js";
import { resolveMigrationsDir, runMigrations } from "../src/database/migrations.js";
import { logger } from "../src/common/logger/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsDir = resolveMigrationsDir(__dirname);
  const applied = await runMigrations(pool, migrationsDir);
  logger.info({ applied }, "Startup migrations complete");

  await import("../src/server.js");
}

main().catch((err) => {
  logger.error({ err }, "Startup failed");
  process.exit(1);
});
