import type pg from "pg";
import type { MaintenanceWindowScope } from "../../config/constants.js";
import type { MaintenanceWindowView } from "../../domain/alerting/suppression.js";

export interface MaintenanceWindowRow extends MaintenanceWindowView {
  maintenanceWindowId: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
}

function fromWire(row: any): MaintenanceWindowRow {
  return {
    maintenanceWindowId: row.maintenance_window_id,
    scope: row.scope,
    scopeValue: row.scope_value,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// created_by is always populated from the acting internal actor's context
// (spec section 23's auditability requirement) — never anonymous.
export async function createMaintenanceWindow(
  client: pg.Pool | pg.PoolClient,
  params: {
    maintenanceWindowId: string;
    scope: MaintenanceWindowScope;
    scopeValue: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    createdBy: string;
  },
): Promise<MaintenanceWindowRow> {
  const { rows } = await client.query(
    `INSERT INTO maintenance_windows (maintenance_window_id, scope, scope_value, starts_at, ends_at, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [params.maintenanceWindowId, params.scope, params.scopeValue, params.startsAt, params.endsAt, params.reason, params.createdBy],
  );
  return fromWire(rows[0]!);
}

// Windows active "now" or overlapping the near future — used by
// suppression.ts's isSuppressedByMaintenanceWindow before opening a new
// alert.
export async function listActiveOrUpcomingWindows(client: pg.Pool | pg.PoolClient, at: Date): Promise<MaintenanceWindowRow[]> {
  const { rows } = await client.query(`SELECT * FROM maintenance_windows WHERE ends_at >= $1 ORDER BY starts_at ASC`, [at]);
  return rows.map(fromWire);
}

export async function listMaintenanceWindows(client: pg.Pool | pg.PoolClient, limit = 100): Promise<MaintenanceWindowRow[]> {
  const { rows } = await client.query(`SELECT * FROM maintenance_windows ORDER BY starts_at DESC LIMIT $1`, [Math.min(limit, 500)]);
  return rows.map(fromWire);
}
