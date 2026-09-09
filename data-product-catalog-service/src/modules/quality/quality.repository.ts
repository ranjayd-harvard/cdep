import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateQualityPolicyId } from "../../common/ids/id-generator.js";

export interface QualityPolicyRow {
  quality_policy_id: string;
  data_product_version_id: string;
  minimum_completeness_percent: string | null;
  maximum_invalid_percent: string | null;
  grain_unique_required: boolean;
  rules: Record<string, unknown>;
}

export async function insertQualityPolicy(
  client: pg.PoolClient,
  input: {
    dataProductVersionId: string;
    minimumCompletenessPercent?: number;
    maximumInvalidPercent?: number;
    grainUniqueRequired: boolean;
    rules?: Record<string, unknown>;
  },
): Promise<QualityPolicyRow> {
  const { rows } = await client.query<QualityPolicyRow>(
    `INSERT INTO catalog.quality_policies
       (quality_policy_id, data_product_version_id, minimum_completeness_percent, maximum_invalid_percent, grain_unique_required, rules)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      generateQualityPolicyId(),
      input.dataProductVersionId,
      input.minimumCompletenessPercent ?? null,
      input.maximumInvalidPercent ?? null,
      input.grainUniqueRequired,
      JSON.stringify(input.rules ?? {}),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create quality policy");
  return row;
}

export async function findQualityPolicy(
  dataProductVersionId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<QualityPolicyRow | null> {
  const { rows } = await client.query<QualityPolicyRow>(
    `SELECT * FROM catalog.quality_policies WHERE data_product_version_id = $1`,
    [dataProductVersionId],
  );
  return rows[0] ?? null;
}
