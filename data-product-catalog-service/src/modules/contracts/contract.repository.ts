import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateContractId } from "../../common/ids/id-generator.js";

export interface ContractRow {
  contract_id: string;
  data_product_version_id: string;
  contract_version: string;
  contract_format: string;
  contract_body: Record<string, unknown>;
  contract_hash: string;
  source_repository: string | null;
  source_path: string | null;
  source_commit: string | null;
  registered_by: string | null;
  registered_at: Date;
  status: string;
}

export async function insertContract(
  client: pg.PoolClient,
  input: {
    dataProductVersionId: string;
    contractVersion: string;
    contractFormat: string;
    contractBody: unknown;
    contractHash: string;
    sourceRepository?: string;
    sourcePath?: string;
    sourceCommit?: string;
    registeredBy?: string;
  },
): Promise<ContractRow> {
  const { rows } = await client.query<ContractRow>(
    `INSERT INTO catalog.contracts
       (contract_id, data_product_version_id, contract_version, contract_format, contract_body, contract_hash, source_repository, source_path, source_commit, registered_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'REGISTERED')
     RETURNING *`,
    [
      generateContractId(),
      input.dataProductVersionId,
      input.contractVersion,
      input.contractFormat,
      JSON.stringify(input.contractBody),
      input.contractHash,
      input.sourceRepository ?? null,
      input.sourcePath ?? null,
      input.sourceCommit ?? null,
      input.registeredBy ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create contract");
  return row;
}

export async function findRegisteredContractForVersion(
  dataProductVersionId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<ContractRow | null> {
  const { rows } = await client.query<ContractRow>(
    `SELECT * FROM catalog.contracts
     WHERE data_product_version_id = $1 AND status = 'REGISTERED'
     ORDER BY registered_at DESC LIMIT 1`,
    [dataProductVersionId],
  );
  return rows[0] ?? null;
}
