import type pg from "pg";
import { pool } from "../../database/pool.js";

export interface DataProductRow {
  data_product_id: string;
  name: string;
  display_name: string;
  domain_id: string;
  owner_id: string;
  description: string | null;
  product_type: string;
  status: string;
  current_active_version: string | null;
  subscribable: boolean;
  discoverable: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function findProduct(
  dataProductId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DataProductRow | null> {
  const { rows } = await client.query<DataProductRow>(
    `SELECT * FROM catalog.data_products WHERE data_product_id = $1`,
    [dataProductId],
  );
  return rows[0] ?? null;
}

export async function createProduct(
  client: pg.PoolClient,
  input: {
    dataProductId: string;
    name: string;
    displayName: string;
    domainId: string;
    ownerId: string;
    description?: string;
    productType: string;
    subscribable?: boolean;
    discoverable?: boolean;
  },
): Promise<DataProductRow> {
  const { rows } = await client.query<DataProductRow>(
    `INSERT INTO catalog.data_products
       (data_product_id, name, display_name, domain_id, owner_id, description, product_type, status, subscribable, discoverable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', COALESCE($8, false), COALESCE($9, true))
     RETURNING *`,
    [
      input.dataProductId,
      input.name,
      input.displayName,
      input.domainId,
      input.ownerId,
      input.description ?? null,
      input.productType,
      input.subscribable ?? null,
      input.discoverable ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create data product");
  return row;
}

export async function updateProductDescriptiveFields(
  client: pg.PoolClient,
  dataProductId: string,
  input: { displayName: string; description?: string; ownerId: string },
): Promise<void> {
  await client.query(
    `UPDATE catalog.data_products
     SET display_name = $2, description = $3, owner_id = $4, updated_at = now()
     WHERE data_product_id = $1`,
    [dataProductId, input.displayName, input.description ?? null, input.ownerId],
  );
}

export async function setCurrentActiveVersion(
  client: pg.PoolClient,
  dataProductId: string,
  version: string | null,
): Promise<void> {
  await client.query(
    `UPDATE catalog.data_products SET current_active_version = $2, updated_at = now() WHERE data_product_id = $1`,
    [dataProductId, version],
  );
}

export async function setProductStatus(client: pg.PoolClient, dataProductId: string, status: string): Promise<void> {
  await client.query(`UPDATE catalog.data_products SET status = $2, updated_at = now() WHERE data_product_id = $1`, [
    dataProductId,
    status,
  ]);
}

export interface ProductSearchFilters {
  search?: string;
  domain?: string;
  status?: string;
  discoverableOnly: boolean;
  limit: number;
  cursor?: string;
}

export interface ProductSearchPage {
  items: DataProductRow[];
  nextCursor: string | null;
}

// Cursor pagination keyed on data_product_id (spec §40 — never return
// unlimited lists). Cursor is simply "the last id seen", since ids sort
// deterministically and product creation is low-volume/append-mostly.
export async function searchProducts(filters: ProductSearchFilters): Promise<ProductSearchPage> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.discoverableOnly) {
    conditions.push(`discoverable = true`);
  }
  if (filters.domain) {
    params.push(filters.domain);
    conditions.push(`domain_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    conditions.push(`(lower(name) LIKE $${params.length} OR lower(display_name) LIKE $${params.length} OR lower(description) LIKE $${params.length})`);
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    conditions.push(`data_product_id > $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(filters.limit + 1);

  const { rows } = await pool.query<DataProductRow>(
    `SELECT * FROM catalog.data_products ${where} ORDER BY data_product_id ASC LIMIT $${params.length}`,
    params,
  );

  const hasMore = rows.length > filters.limit;
  const items = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? last.data_product_id : null };
}
