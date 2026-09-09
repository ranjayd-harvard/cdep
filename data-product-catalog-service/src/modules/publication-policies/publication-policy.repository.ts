import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generatePublicationPolicyId } from "../../common/ids/id-generator.js";

export interface PublicationPolicyRow {
  publication_policy_id: string;
  data_product_version_id: string;
  default_format: string | null;
  supported_formats: string[];
  expiration_hours: number | null;
  filename_pattern: string | null;
  compression_policy: Record<string, unknown>;
  default_delivery_mode: string | null;
}

export async function insertPublicationPolicy(
  client: pg.PoolClient,
  input: {
    dataProductVersionId: string;
    defaultFormat?: string;
    supportedFormats?: string[];
    expirationHours?: number;
    filenamePattern?: string;
    compressionPolicy?: Record<string, unknown>;
    defaultDeliveryMode?: string;
  },
): Promise<PublicationPolicyRow> {
  const { rows } = await client.query<PublicationPolicyRow>(
    `INSERT INTO catalog.publication_policies
       (publication_policy_id, data_product_version_id, default_format, supported_formats, expiration_hours, filename_pattern, compression_policy, default_delivery_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      generatePublicationPolicyId(),
      input.dataProductVersionId,
      input.defaultFormat ?? null,
      JSON.stringify(input.supportedFormats ?? []),
      input.expirationHours ?? null,
      input.filenamePattern ?? null,
      JSON.stringify(input.compressionPolicy ?? {}),
      input.defaultDeliveryMode ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create publication policy");
  return row;
}

export async function findPublicationPolicy(
  dataProductVersionId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<PublicationPolicyRow | null> {
  const { rows } = await client.query<PublicationPolicyRow>(
    `SELECT * FROM catalog.publication_policies WHERE data_product_version_id = $1`,
    [dataProductVersionId],
  );
  return rows[0] ?? null;
}
