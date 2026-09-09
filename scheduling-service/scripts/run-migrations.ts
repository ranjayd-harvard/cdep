import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/database/pool.js";
import { resolveMigrationsDir, runMigrations } from "../src/database/migrations.js";
import { logger } from "../src/common/logger/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsDir = resolveMigrationsDir(__dirname);
  const applied = await runMigrations(pool, migrationsDir);
  if (applied.length === 0) {
    logger.info("No pending migrations.");
  } else {
    logger.info({ applied }, "Migrations applied");
  }
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "Migration run failed");
  process.exit(1);
});
