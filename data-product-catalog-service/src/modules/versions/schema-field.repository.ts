import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateSchemaFieldId } from "../../common/ids/id-generator.js";
import type { SchemaFieldInput } from "../../registration/contract-schema.js";

export interface SchemaFieldRow {
  schema_field_id: string;
  data_product_version_id: string;
  ordinal: number;
  field_name: string;
  data_type: string;
  nullable: boolean;
  description: string | null;
  classification: string | null;
  business_key: boolean;
  grain_key: boolean;
  customer_visible: boolean;
  pii: boolean;
  pii_type: string | null;
  masking_policy: string | null;
}

export async function insertSchemaFields(
  client: pg.PoolClient,
  dataProductVersionId: string,
  fields: SchemaFieldInput[],
): Promise<void> {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    await client.query(
      `INSERT INTO catalog.product_schema_fields
         (schema_field_id, data_product_version_id, ordinal, field_name, data_type, nullable, description, classification, business_key, grain_key, customer_visible, pii, pii_type, masking_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        generateSchemaFieldId(),
        dataProductVersionId,
        i,
        field.name,
        field.type,
        !field.required,
        field.description ?? null,
        field.classification ?? null,
        field.businessKey,
        field.grainKey,
        field.customerVisible,
        field.pii,
        field.piiType ?? null,
        field.maskingPolicy ?? null,
      ],
    );
  }
}

export async function listSchemaFields(
  dataProductVersionId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<SchemaFieldRow[]> {
  const { rows } = await client.query<SchemaFieldRow>(
    `SELECT * FROM catalog.product_schema_fields WHERE data_product_version_id = $1 ORDER BY ordinal ASC`,
    [dataProductVersionId],
  );
  return rows;
}
