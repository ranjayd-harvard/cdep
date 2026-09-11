import type pg from "pg";
import type { AlertSeverity, IncidentState } from "../../config/constants.js";

export interface IncidentRow {
  incidentId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  title: string;
  severity: AlertSeverity;
  state: IncidentState;
  openedAt: Date;
  resolvedAt: Date | null;
}

function fromWire(row: any): IncidentRow {
  return {
    incidentId: row.incident_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    productVersion: row.product_version,
    title: row.title,
    severity: row.severity,
    state: row.state,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
  };
}

export async function createIncident(
  client: pg.Pool | pg.PoolClient,
  params: {
    incidentId: string;
    organizationId: string;
    tenantId: string;
    dataProductId: string;
    productVersion: string;
    title: string;
    severity: AlertSeverity;
  },
): Promise<IncidentRow> {
  const { rows } = await client.query(
    `INSERT INTO incidents (incident_id, organization_id, tenant_id, data_product_id, product_version, title, severity)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [params.incidentId, params.organizationId, params.tenantId, params.dataProductId, params.productVersion, params.title, params.severity],
  );
  return fromWire(rows[0]!);
}

export async function linkAlert(client: pg.Pool | pg.PoolClient, incidentId: string, alertId: string): Promise<void> {
  await client.query(
    "INSERT INTO incident_alerts (incident_id, alert_id) VALUES ($1, $2) ON CONFLICT (incident_id, alert_id) DO NOTHING",
    [incidentId, alertId],
  );
}

export async function findIncidentById(client: pg.Pool | pg.PoolClient, incidentId: string): Promise<IncidentRow | null> {
  const { rows } = await client.query("SELECT * FROM incidents WHERE incident_id = $1", [incidentId]);
  return rows[0] ? fromWire(rows[0]) : null;
}

// An incident auto-resolves once every alert linked to it has resolved
// (spec section 24) — never a manual-only workflow, and never a full ITSM
// state machine beyond OPEN/RESOLVED.
export async function resolveIncidentIfAllAlertsResolved(client: pg.Pool | pg.PoolClient, incidentId: string): Promise<void> {
  await client.query(
    `UPDATE incidents SET state = 'RESOLVED', resolved_at = now(), updated_at = now()
     WHERE incident_id = $1 AND state = 'OPEN'
       AND NOT EXISTS (
         SELECT 1 FROM incident_alerts ia
         JOIN alerts a ON a.alert_id = ia.alert_id
         WHERE ia.incident_id = $1 AND a.state NOT IN ('RESOLVED')
       )`,
    [incidentId],
  );
}

export interface IncidentListFilters {
  tenantId?: string;
  dataProductId?: string;
  state?: IncidentState;
  limit?: number;
}

export async function listIncidents(client: pg.Pool | pg.PoolClient, filters: IncidentListFilters): Promise<IncidentRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  function add(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  }
  if (filters.tenantId) add("tenant_id = ?", filters.tenantId);
  if (filters.dataProductId) add("data_product_id = ?", filters.dataProductId);
  if (filters.state) add("state = ?", filters.state);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 100, 500);
  const { rows } = await client.query(`SELECT * FROM incidents ${where} ORDER BY opened_at DESC LIMIT $${values.length + 1}`, [
    ...values,
    limit,
  ]);
  return rows.map(fromWire);
}
