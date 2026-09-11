import pg from "pg";
import { env, lakehouseMetadataEnabled } from "../config/env.js";

// Direct, read-only connection to data-lakehouse's own Postgres (the
// `lakehouse` schema — deliberately separate from Iceberg's own catalog
// metadata). This mirrors the real precedent data-publication-service
// already uses for the exact same database
// (PUBLICATION_LAKEHOUSE_METADATA_DB_URL), rather than inventing a new
// cross-service access pattern. This service never writes through this
// pool — only SELECT against lakehouse.ingestion_runs / pipeline_runs /
// quality_results.
export const lakehousePool: pg.Pool | null = lakehouseMetadataEnabled
  ? new pg.Pool({
      connectionString: env.LAKEHOUSE_METADATA_DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30_000,
    })
  : null;

export async function checkLakehouseHealth(): Promise<boolean> {
  if (!lakehousePool) return false;
  try {
    await lakehousePool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
