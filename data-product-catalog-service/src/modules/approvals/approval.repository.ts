import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateVersionApprovalId } from "../../common/ids/id-generator.js";
import type { CompatibilityLevel } from "../../config/constants.js";

export interface VersionApprovalRow {
  approval_id: string;
  data_product_id: string;
  version: string;
  compatibility_level: CompatibilityLevel;
  required: boolean;
  approved_by: string;
  approved_reason: string | null;
  approved_at: Date;
}

// Phase 10 §10/§24: a flat approval log, not a workflow engine. One row
// per approval action — there is no "pending" state to transition through,
// so recording a row IS the approval.
export async function recordApproval(
  client: pg.Pool | pg.PoolClient,
  input: {
    dataProductId: string;
    version: string;
    compatibilityLevel: CompatibilityLevel;
    required: boolean;
    approvedBy: string;
    approvedReason?: string;
  },
): Promise<VersionApprovalRow> {
  const { rows } = await client.query<VersionApprovalRow>(
    `INSERT INTO catalog.version_approvals
       (approval_id, data_product_id, version, compatibility_level, required, approved_by, approved_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      generateVersionApprovalId(),
      input.dataProductId,
      input.version,
      input.compatibilityLevel,
      input.required,
      input.approvedBy,
      input.approvedReason ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to record version approval");
  return row;
}

export async function findLatestApproval(
  dataProductId: string,
  version: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<VersionApprovalRow | null> {
  const { rows } = await client.query<VersionApprovalRow>(
    `SELECT * FROM catalog.version_approvals
      WHERE data_product_id = $1 AND version = $2
      ORDER BY approved_at DESC
      LIMIT 1`,
    [dataProductId, version],
  );
  return rows[0] ?? null;
}
