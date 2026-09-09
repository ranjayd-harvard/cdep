import type pg from "pg";
import { generateProjectionId } from "../../common/ids/id-generator.js";
import type { DayOfWeek, ScheduleMode } from "../../config/constants.js";
import type { SchedulerProjection } from "../../domain/execution.js";
import type { Queryable } from "./queryable.js";

interface ProjectionRow {
  id: string;
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  subscription_status: string;
  schedule_mode: ScheduleMode;
  timezone: string | null;
  delivery_time_local: string | null;
  day_of_week: DayOfWeek | null;
  cron_expression: string | null;
  next_run_at: Date | null;
  last_reconciled_at: Date;
  subscription_revision: string | number;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: ProjectionRow): SchedulerProjection {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    subscriptionStatus: row.subscription_status,
    scheduleMode: row.schedule_mode,
    timezone: row.timezone,
    deliveryTimeLocal: row.delivery_time_local,
    dayOfWeek: row.day_of_week,
    cronExpression: row.cron_expression,
    nextRunAt: row.next_run_at,
    lastReconciledAt: row.last_reconciled_at,
    subscriptionRevision: Number(row.subscription_revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertProjectionInput {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  subscriptionStatus: string;
  scheduleMode: ScheduleMode;
  timezone: string | null;
  deliveryTimeLocal: string | null;
  dayOfWeek: DayOfWeek | null;
  cronExpression: string | null;
  nextRunAt: Date | null;
  subscriptionRevision: number;
}

// Reconciliation-only write path (AGENTS.md section 49) — always a full
// upsert keyed on subscription_id, treating Subscription Service as the
// sole source of truth for every field except next_run_at (which the
// Scheduler itself computes and owns).
export async function upsertProjection(db: Queryable, input: UpsertProjectionInput): Promise<SchedulerProjection> {
  const { rows } = await db.query<ProjectionRow>(
    `INSERT INTO scheduler_subscription_projection (
       id, subscription_id, organization_id, tenant_id, data_product_id,
       subscription_status, schedule_mode, timezone, delivery_time_local,
       day_of_week, cron_expression, next_run_at, subscription_revision,
       last_reconciled_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
     ON CONFLICT (subscription_id) DO UPDATE SET
       subscription_status = EXCLUDED.subscription_status,
       schedule_mode = EXCLUDED.schedule_mode,
       timezone = EXCLUDED.timezone,
       delivery_time_local = EXCLUDED.delivery_time_local,
       day_of_week = EXCLUDED.day_of_week,
       cron_expression = EXCLUDED.cron_expression,
       next_run_at = EXCLUDED.next_run_at,
       subscription_revision = EXCLUDED.subscription_revision,
       last_reconciled_at = now(),
       updated_at = now()
     RETURNING *`,
    [
      generateProjectionId(),
      input.subscriptionId,
      input.organizationId,
      input.tenantId,
      input.dataProductId,
      input.subscriptionStatus,
      input.scheduleMode,
      input.timezone,
      input.deliveryTimeLocal,
      input.dayOfWeek,
      input.cronExpression,
      input.nextRunAt,
      input.subscriptionRevision,
    ],
  );
  return mapRow(rows[0] as ProjectionRow);
}

export async function findProjectionBySubscriptionId(db: Queryable, subscriptionId: string): Promise<SchedulerProjection | null> {
  const { rows } = await db.query<ProjectionRow>(`SELECT * FROM scheduler_subscription_projection WHERE subscription_id = $1`, [subscriptionId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

// Atomic claim (AGENTS.md section 34): FOR UPDATE SKIP LOCKED so two
// scheduler processes (or two leadership-transition instants) racing the
// same scan can never both claim the same due projection. Must run inside
// a short transaction — the caller commits before doing any network I/O.
export async function claimDueProjections(client: pg.PoolClient, now: Date, limit: number): Promise<SchedulerProjection[]> {
  const { rows } = await client.query<ProjectionRow>(
    `SELECT * FROM scheduler_subscription_projection
     WHERE schedule_mode <> 'ON_DEMAND' AND next_run_at IS NOT NULL AND next_run_at <= $1
     ORDER BY next_run_at ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [now, limit],
  );
  return rows.map(mapRow);
}

export async function updateNextRunAt(client: pg.PoolClient, id: string, nextRunAt: Date | null): Promise<void> {
  await client.query(`UPDATE scheduler_subscription_projection SET next_run_at = $2, updated_at = now() WHERE id = $1`, [id, nextRunAt]);
}
