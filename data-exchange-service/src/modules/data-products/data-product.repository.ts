import { pool } from "../../database/pool.js";

export interface DataProductRow {
  data_product_id: string;
  name: string;
  description: string | null;
  direction: string;
  current_schema_version: string;
  status: string;
}

export interface EntitlementRow {
  tenant_id: string;
  data_product_id: string;
  can_upload: boolean;
  can_download: boolean;
  status: string;
}

export async function getDataProduct(dataProductId: string): Promise<DataProductRow | null> {
  const { rows } = await pool.query<DataProductRow>(
    `SELECT * FROM exchange.data_products WHERE data_product_id = $1`,
    [dataProductId],
  );
  return rows[0] ?? null;
}

export async function getEntitlement(tenantId: string, dataProductId: string): Promise<EntitlementRow | null> {
  const { rows } = await pool.query<EntitlementRow>(
    `SELECT * FROM exchange.tenant_data_product_entitlements
     WHERE tenant_id = $1 AND data_product_id = $2`,
    [tenantId, dataProductId],
  );
  return rows[0] ?? null;
}

export async function listDataProducts(): Promise<DataProductRow[]> {
  const { rows } = await pool.query<DataProductRow>(
    `SELECT * FROM exchange.data_products WHERE status = 'ACTIVE' ORDER BY name ASC`,
  );
  return rows;
}
