import type pg from "pg";
import type { AlertSeverity, AlertState, AlertType } from "../../config/constants.js";

export interface AlertRow {
  alertId: string;
  dedupKey: string;
  alertType: AlertType;
  severity: AlertSeverity;
  state: AlertState;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  executionId: string | null;
  title: string;
  description: string | null;
  openedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  suppressedUntil: Date | null;
  incidentId: string | null;
}

function fromWire(row: any): AlertRow {
  return {
    alertId: row.alert_id,
    dedupKey: row.dedup_key,
    alertType: row.alert_type,
    severity: row.severity,
    state: row.state,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    productVersion: row.product_version,
    executionId: row.execution_id,
    title: row.title,
    description: row.description,
    openedAt: row.opened_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    suppressedUntil: row.suppressed_until,
    incidentId: row.incident_id,
  };
}

// Deterministic-dedup-key UPSERT (spec section 22, migrations/008's UNIQUE
// constraint on dedup_key): a repeated rule-fire for the same scope either
// reopens a RESOLVED alert or is a no-op against an already-OPEN one,
// rather than ever creating a duplicate row. `suppressed` forces state to
// SUPPRESSED instead of OPEN (domain/alerting/suppression.ts already
// decided this before the repository is called).
export async function upsertAlert(
  client: pg.Pool | pg.PoolClient,
  params: {
    alertId: string;
    dedupKey: string;
    alertType: AlertType;
    severity: AlertSeverity;
    organizationId: string;
    tenantId: string;
    dataProductId: string;
    productVersion: string;
    executionId: string | null;
    title: string;
    description: string;
    suppressed: boolean;
    suppressedUntil: Date | null;
  },
): Promise<AlertRow> {
  const { rows } = await client.query(
    `INSERT INTO alerts
       (alert_id, dedup_key, alert_type, severity, state, organization_id, tenant_id, data_product_id,
        product_version, execution_id, title, description, suppressed_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (dedup_key) DO UPDATE SET
       state = CASE
         WHEN alerts.state = 'RESOLVED' THEN EXCLUDED.state
         WHEN alerts.state = 'SUPPRESSED' AND NOT $14 THEN 'OPEN'
         ELSE alerts.state
       END,
       description = EXCLUDED.description,
       suppressed_until = EXCLUDED.suppressed_until,
       updated_at = now()
     RETURNING *`,
    [
      params.alertId,
      params.dedupKey,
      params.alertType,
      params.severity,
      params.suppressed ? "SUPPRESSED" : "OPEN",
      params.organizationId,
      params.tenantId,
      params.dataProductId,
      params.productVersion,
      params.executionId,
      params.title,
      params.description,
      params.suppressedUntil,
      params.suppressed,
    ],
  );
  return fromWire(rows[0]!);
}

export async function findAlertById(client: pg.Pool | pg.PoolClient, alertId: string): Promise<AlertRow | null> {
  const { rows } = await client.query("SELECT * FROM alerts WHERE alert_id = $1", [alertId]);
  return rows[0] ? fromWire(rows[0]) : null;
}

export async function acknowledgeAlert(client: pg.Pool | pg.PoolClient, alertId: string, actorId: string): Promise<AlertRow | null> {
  const { rows } = await client.query(
    `UPDATE alerts SET state = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by = $2, updated_at = now()
     WHERE alert_id = $1 RETURNING *`,
    [alertId, actorId],
  );
  return rows[0] ? fromWire(rows[0]) : null;
}

export async function resolveAlert(client: pg.Pool | pg.PoolClient, alertId: string, actorId: string): Promise<AlertRow | null> {
  const { rows } = await client.query(
    `UPDATE alerts SET state = 'RESOLVED', resolved_at = now(), resolved_by = $2, updated_at = now()
     WHERE alert_id = $1 RETURNING *`,
    [alertId, actorId],
  );
  return rows[0] ? fromWire(rows[0]) : null;
}

export async function suppressAlert(client: pg.Pool | pg.PoolClient, alertId: string, suppressedUntil: Date): Promise<AlertRow | null> {
  const { rows } = await client.query(
    `UPDATE alerts SET state = 'SUPPRESSED', suppressed_until = $2, updated_at = now() WHERE alert_id = $1 RETURNING *`,
    [alertId, suppressedUntil],
  );
  return rows[0] ? fromWire(rows[0]) : null;
}

export async function linkAlertToIncident(client: pg.Pool | pg.PoolClient, alertId: string, incidentId: string): Promise<void> {
  await client.query("UPDATE alerts SET incident_id = $2, updated_at = now() WHERE alert_id = $1", [alertId, incidentId]);
}

export interface AlertListFilters {
  organizationId?: string;
  tenantId?: string;
  dataProductId?: string;
  state?: AlertState;
  severity?: AlertSeverity;
  limit?: number;
}

export async function listAlerts(client: pg.Pool | pg.PoolClient, filters: AlertListFilters): Promise<AlertRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  function add(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  }
  if (filters.organizationId) add("organization_id = ?", filters.organizationId);
  if (filters.tenantId) add("tenant_id = ?", filters.tenantId);
  if (filters.dataProductId) add("data_product_id = ?", filters.dataProductId);
  if (filters.state) add("state = ?", filters.state);
  if (filters.severity) add("severity = ?", filters.severity);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 100, 500);
  const { rows } = await client.query(`SELECT * FROM alerts ${where} ORDER BY opened_at DESC LIMIT $${values.length + 1}`, [
    ...values,
    limit,
  ]);
  return rows.map(fromWire);
}

// Recent alerts in the same scope, used by the incident correlator (spec
// section 24) to decide whether a newly-opened alert should join an
// existing incident.
export async function listRecentAlertsForScope(
  client: pg.Pool | pg.PoolClient,
  scope: { tenantId: string; dataProductId: string; productVersion: string },
  sinceMinutesAgo: number,
): Promise<AlertRow[]> {
  const { rows } = await client.query(
    `SELECT * FROM alerts
     WHERE tenant_id = $1 AND data_product_id = $2 AND product_version = $3
       AND opened_at > now() - ($4 || ' minutes')::interval
     ORDER BY opened_at DESC`,
    [scope.tenantId, scope.dataProductId, scope.productVersion, sinceMinutesAgo],
  );
  return rows.map(fromWire);
}
