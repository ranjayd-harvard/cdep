import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateDataProductVersionId } from "../../common/ids/id-generator.js";

export interface DataProductVersionRow {
  data_product_version_id: string;
  data_product_id: string;
  version: string;
  lifecycle_status: string;
  contract_version: string;
  schema_version: string;
  description: string | null;
  grain_definition: string | null;
  breaking_change: boolean;
  effective_from: Date | null;
  deprecated_at: Date | null;
  retired_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function findVersion(
  dataProductId: string,
  version: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DataProductVersionRow | null> {
  const { rows } = await client.query<DataProductVersionRow>(
    `SELECT * FROM catalog.data_product_versions WHERE data_product_id = $1 AND version = $2`,
    [dataProductId, version],
  );
  return rows[0] ?? null;
}

export async function findVersionById(
  dataProductVersionId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DataProductVersionRow | null> {
  const { rows } = await client.query<DataProductVersionRow>(
    `SELECT * FROM catalog.data_product_versions WHERE data_product_version_id = $1`,
    [dataProductVersionId],
  );
  return rows[0] ?? null;
}

// The "previous" version used for compatibility/semver comparison is the
// highest-semver version registered so far for this product, regardless of
// its lifecycle status — see registration.service.ts for why (spec §61's
// worked example compares 1.2.0 and 2.0.0 both against 1.1.0, which by then
// is no longer the ACTIVE version).
export async function findLatestVersion(
  dataProductId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DataProductVersionRow | null> {
  const { rows } = await client.query<DataProductVersionRow>(
    `SELECT * FROM catalog.data_product_versions WHERE data_product_id = $1
     ORDER BY
       (regexp_match(version, '^(\\d+)'))[1]::int DESC,
       COALESCE((regexp_match(version, '^\\d+\\.(\\d+)'))[1]::int, 0) DESC,
       COALESCE((regexp_match(version, '^\\d+\\.\\d+\\.(\\d+)'))[1]::int, 0) DESC
     LIMIT 1`,
    [dataProductId],
  );
  return rows[0] ?? null;
}

export async function findActiveVersion(
  dataProductId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DataProductVersionRow | null> {
  const { rows } = await client.query<DataProductVersionRow>(
    `SELECT * FROM catalog.data_product_versions WHERE data_product_id = $1 AND lifecycle_status = 'ACTIVE'`,
    [dataProductId],
  );
  return rows[0] ?? null;
}

export async function listVersions(
  dataProductId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DataProductVersionRow[]> {
  const { rows } = await client.query<DataProductVersionRow>(
    `SELECT * FROM catalog.data_product_versions WHERE data_product_id = $1 ORDER BY created_at ASC`,
    [dataProductId],
  );
  return rows;
}

export async function createVersion(
  client: pg.PoolClient,
  input: {
    dataProductId: string;
    version: string;
    contractVersion: string;
    schemaVersion: string;
    description?: string;
    grainDefinition?: string;
    breakingChange: boolean;
  },
): Promise<DataProductVersionRow> {
  const id = generateDataProductVersionId();
  const { rows } = await client.query<DataProductVersionRow>(
    `INSERT INTO catalog.data_product_versions
       (data_product_version_id, data_product_id, version, lifecycle_status, contract_version, schema_version, description, grain_definition, breaking_change)
     VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      input.dataProductId,
      input.version,
      input.contractVersion,
      input.schemaVersion,
      input.description ?? null,
      input.grainDefinition ?? null,
      input.breakingChange,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create data product version");
  return row;
}

export async function setLifecycleStatus(
  client: pg.PoolClient,
  dataProductVersionId: string,
  status: string,
  timestamps: { effectiveFrom?: Date; deprecatedAt?: Date; retiredAt?: Date } = {},
): Promise<void> {
  await client.query(
    `UPDATE catalog.data_product_versions
     SET lifecycle_status = $2,
         effective_from = COALESCE($3, effective_from),
         deprecated_at = COALESCE($4, deprecated_at),
         retired_at = COALESCE($5, retired_at),
         updated_at = now()
     WHERE data_product_version_id = $1`,
    [dataProductVersionId, status, timestamps.effectiveFrom ?? null, timestamps.deprecatedAt ?? null, timestamps.retiredAt ?? null],
  );
}
