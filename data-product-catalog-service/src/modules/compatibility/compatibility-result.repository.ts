import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateCompatibilityResultId } from "../../common/ids/id-generator.js";
import type { CompatibilityChange } from "./compatibility.service.js";
import type { CompatibilityLevel } from "../../config/constants.js";

export interface VersionCompatibilityResultRow {
  compatibility_result_id: string;
  data_product_id: string;
  from_version: string | null;
  to_version: string;
  compatibility_level: CompatibilityLevel;
  changes: CompatibilityChange[];
  evaluated_at: Date;
}

// Phase 10 §7/§14: one row per compatibility *evaluation* — registration
// time and dry-run `evaluate-compatibility` calls (§23) both call this, so
// the table captures every evaluation attempted, not just the ones that
// resulted in a persisted version.
export async function recordCompatibilityResult(
  client: pg.Pool | pg.PoolClient,
  input: {
    dataProductId: string;
    fromVersion: string | null;
    toVersion: string;
    level: CompatibilityLevel;
    changes: CompatibilityChange[];
  },
): Promise<VersionCompatibilityResultRow> {
  const { rows } = await client.query<VersionCompatibilityResultRow>(
    `INSERT INTO catalog.version_compatibility_results
       (compatibility_result_id, data_product_id, from_version, to_version, compatibility_level, changes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      generateCompatibilityResultId(),
      input.dataProductId,
      input.fromVersion,
      input.toVersion,
      input.level,
      JSON.stringify(input.changes),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to record compatibility result");
  return row;
}

export async function findLatestCompatibilityResult(
  dataProductId: string,
  toVersion: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<VersionCompatibilityResultRow | null> {
  const { rows } = await client.query<VersionCompatibilityResultRow>(
    `SELECT * FROM catalog.version_compatibility_results
      WHERE data_product_id = $1 AND to_version = $2
      ORDER BY evaluated_at DESC
      LIMIT 1`,
    [dataProductId, toVersion],
  );
  return rows[0] ?? null;
}

export async function listCompatibilityResults(
  dataProductId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<VersionCompatibilityResultRow[]> {
  const { rows } = await client.query<VersionCompatibilityResultRow>(
    `SELECT * FROM catalog.version_compatibility_results WHERE data_product_id = $1 ORDER BY evaluated_at DESC`,
    [dataProductId],
  );
  return rows;
}
