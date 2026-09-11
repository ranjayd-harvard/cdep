import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateBetaOptInId } from "../../common/ids/id-generator.js";

export interface BetaOptInRow {
  beta_opt_in_id: string;
  data_product_version_id: string;
  organization_id: string;
  tenant_id: string;
  opted_in_by: string;
  opted_in_at: Date;
}

// Phase 10 §11/§18/§28: a BETA version is unreachable except via explicit
// EXACT-policy resolution by a tenant with a row here (or the explicit-
// version API route, which resolves the same way).
export async function grantOptIn(
  client: pg.Pool | pg.PoolClient,
  input: { dataProductVersionId: string; organizationId: string; tenantId: string; optedInBy: string },
): Promise<BetaOptInRow> {
  const { rows } = await client.query<BetaOptInRow>(
    `INSERT INTO catalog.version_beta_opt_ins (beta_opt_in_id, data_product_version_id, organization_id, tenant_id, opted_in_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (data_product_version_id, organization_id, tenant_id) DO UPDATE SET opted_in_by = EXCLUDED.opted_in_by
     RETURNING *`,
    [generateBetaOptInId(), input.dataProductVersionId, input.organizationId, input.tenantId, input.optedInBy],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to record beta opt-in");
  return row;
}

export async function hasOptIn(
  dataProductVersionId: string,
  organizationId: string,
  tenantId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM catalog.version_beta_opt_ins WHERE data_product_version_id = $1 AND organization_id = $2 AND tenant_id = $3`,
    [dataProductVersionId, organizationId, tenantId],
  );
  return rows.length > 0;
}
