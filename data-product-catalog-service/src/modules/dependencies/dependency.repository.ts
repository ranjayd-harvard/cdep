import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateVersionDependencyId } from "../../common/ids/id-generator.js";

export interface VersionDependencyRow {
  version_dependency_id: string;
  dependent_data_product_id: string;
  dependent_version: string;
  depends_on_data_product_id: string;
  min_version: string;
  max_version: string | null;
  created_at: Date;
}

// Phase 10 §8/§25. max_version is EXCLUSIVE, min_version INCLUSIVE, by
// convention (documented once here — see the 015 migration's own comment).
export async function insertDependency(
  client: pg.Pool | pg.PoolClient,
  input: {
    dependentDataProductId: string;
    dependentVersion: string;
    dependsOnDataProductId: string;
    minVersion: string;
    maxVersion?: string | null;
  },
): Promise<VersionDependencyRow> {
  const { rows } = await client.query<VersionDependencyRow>(
    `INSERT INTO catalog.version_dependencies
       (version_dependency_id, dependent_data_product_id, dependent_version, depends_on_data_product_id, min_version, max_version)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dependent_data_product_id, dependent_version, depends_on_data_product_id)
     DO UPDATE SET min_version = EXCLUDED.min_version, max_version = EXCLUDED.max_version
     RETURNING *`,
    [
      generateVersionDependencyId(),
      input.dependentDataProductId,
      input.dependentVersion,
      input.dependsOnDataProductId,
      input.minVersion,
      input.maxVersion ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to declare version dependency");
  return row;
}

// Every dependency declared BY this product (i.e. what dataProductId/version
// itself requires from other products).
export async function listDependencies(
  dataProductId: string,
  version: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<VersionDependencyRow[]> {
  const { rows } = await client.query<VersionDependencyRow>(
    `SELECT * FROM catalog.version_dependencies WHERE dependent_data_product_id = $1 AND dependent_version = $2`,
    [dataProductId, version],
  );
  return rows;
}

// Every dependency declared ON this product (i.e. who requires
// dataProductId, and within what version range) — used by the retirement
// guard (spec §21 point 5) and impact analysis.
export async function listDependents(
  dataProductId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<VersionDependencyRow[]> {
  const { rows } = await client.query<VersionDependencyRow>(
    `SELECT * FROM catalog.version_dependencies WHERE depends_on_data_product_id = $1`,
    [dataProductId],
  );
  return rows;
}
