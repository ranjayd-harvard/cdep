import type pg from "pg";

export interface InsertMetricParams {
  metricName: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  stage: string | null;
  deliveryMethod: "FILE" | "API" | null;
  timeWindowStart: Date;
  timeWindowEnd: Date;
  value: number;
  unit: string | null;
  dimensionsJson: Record<string, unknown>;
}

// Dimensional metric rows only (spec section 14/16) — never an
// execution_id/request_id/trace_id column or label, by design (migrations/
// 005's comment / plan section 6).
export async function insertMetric(client: pg.Pool | pg.PoolClient, params: InsertMetricParams): Promise<void> {
  await client.query(
    `INSERT INTO operational_metrics
       (metric_name, organization_id, tenant_id, data_product_id, product_version, stage, delivery_method,
        time_window_start, time_window_end, value, unit, dimensions_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      params.metricName,
      params.organizationId,
      params.tenantId,
      params.dataProductId,
      params.productVersion,
      params.stage,
      params.deliveryMethod,
      params.timeWindowStart,
      params.timeWindowEnd,
      params.value,
      params.unit,
      params.dimensionsJson,
    ],
  );
}

export interface MetricQueryFilters {
  metricName?: string;
  dataProductId?: string;
  productVersion?: string;
  tenantId?: string;
  stage?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface MetricRow {
  metricName: string;
  dataProductId: string;
  productVersion: string;
  tenantId: string;
  stage: string | null;
  deliveryMethod: "FILE" | "API" | null;
  timeWindowStart: Date;
  timeWindowEnd: Date;
  value: number;
  unit: string | null;
}

export async function queryMetrics(client: pg.Pool | pg.PoolClient, filters: MetricQueryFilters): Promise<MetricRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  function add(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  }
  if (filters.metricName) add("metric_name = ?", filters.metricName);
  if (filters.dataProductId) add("data_product_id = ?", filters.dataProductId);
  if (filters.productVersion) add("product_version = ?", filters.productVersion);
  if (filters.tenantId) add("tenant_id = ?", filters.tenantId);
  if (filters.stage) add("stage = ?", filters.stage);
  if (filters.from) add("time_window_start >= ?", filters.from);
  if (filters.to) add("time_window_end <= ?", filters.to);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 100, 1000);

  const { rows } = await client.query(
    `SELECT metric_name, data_product_id, product_version, tenant_id, stage, delivery_method,
            time_window_start, time_window_end, value, unit
     FROM operational_metrics ${where}
     ORDER BY time_window_start DESC LIMIT $${values.length + 1}`,
    [...values, limit],
  );

  return rows.map((r) => ({
    metricName: r.metric_name,
    dataProductId: r.data_product_id,
    productVersion: r.product_version,
    tenantId: r.tenant_id,
    stage: r.stage,
    deliveryMethod: r.delivery_method,
    timeWindowStart: r.time_window_start,
    timeWindowEnd: r.time_window_end,
    value: Number(r.value),
    unit: r.unit,
  }));
}
