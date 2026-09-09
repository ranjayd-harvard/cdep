import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateDeliveryMethodId } from "../../common/ids/id-generator.js";

export interface DeliveryMethodRow {
  delivery_method_id: string;
  data_product_version_id: string;
  method: string;
  enabled: boolean;
  configuration: Record<string, unknown>;
}

export async function insertDeliveryMethod(
  client: pg.PoolClient,
  input: { dataProductVersionId: string; method: string; enabled: boolean; configuration?: Record<string, unknown> },
): Promise<DeliveryMethodRow> {
  const { rows } = await client.query<DeliveryMethodRow>(
    `INSERT INTO catalog.supported_delivery_methods
       (delivery_method_id, data_product_version_id, method, enabled, configuration)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [generateDeliveryMethodId(), input.dataProductVersionId, input.method, input.enabled, JSON.stringify(input.configuration ?? {})],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create delivery method");
  return row;
}

export async function listDeliveryMethods(
  dataProductVersionId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DeliveryMethodRow[]> {
  const { rows } = await client.query<DeliveryMethodRow>(
    `SELECT * FROM catalog.supported_delivery_methods WHERE data_product_version_id = $1 ORDER BY method ASC`,
    [dataProductVersionId],
  );
  return rows;
}
