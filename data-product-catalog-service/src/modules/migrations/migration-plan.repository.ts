import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateMigrationPlanId, generateMigrationSubscriptionId } from "../../common/ids/id-generator.js";
import type { CompatibilityLevel } from "../../config/constants.js";

export type MigrationPlanStatus = "PLANNED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
export type MigrationSubscriptionStatus = "PENDING" | "MIGRATED" | "FAILED" | "SKIPPED";

export interface MigrationPlanRow {
  migration_id: string;
  data_product_id: string;
  from_version: string;
  to_version: string;
  compatibility: CompatibilityLevel;
  status: MigrationPlanStatus;
  start_at: Date | null;
  deadline: Date | null;
  reason: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MigrationSubscriptionRow {
  migration_subscription_id: string;
  migration_id: string;
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  status: MigrationSubscriptionStatus;
  migrated_at: Date | null;
  failure_reason: string | null;
}

export async function createMigrationPlan(
  client: pg.Pool | pg.PoolClient,
  input: {
    dataProductId: string;
    fromVersion: string;
    toVersion: string;
    compatibility: CompatibilityLevel;
    startAt?: Date;
    deadline?: Date;
    reason?: string;
    createdBy?: string;
  },
): Promise<MigrationPlanRow> {
  const { rows } = await client.query<MigrationPlanRow>(
    `INSERT INTO catalog.migration_plans
       (migration_id, data_product_id, from_version, to_version, compatibility, start_at, deadline, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      generateMigrationPlanId(),
      input.dataProductId,
      input.fromVersion,
      input.toVersion,
      input.compatibility,
      input.startAt ?? null,
      input.deadline ?? null,
      input.reason ?? null,
      input.createdBy ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create migration plan");
  return row;
}

export async function findMigrationPlan(
  migrationId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<MigrationPlanRow | null> {
  const { rows } = await client.query<MigrationPlanRow>(`SELECT * FROM catalog.migration_plans WHERE migration_id = $1`, [migrationId]);
  return rows[0] ?? null;
}

export async function listMigrationPlans(
  dataProductId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<MigrationPlanRow[]> {
  const { rows } = await client.query<MigrationPlanRow>(
    `SELECT * FROM catalog.migration_plans WHERE data_product_id = $1 ORDER BY created_at DESC`,
    [dataProductId],
  );
  return rows;
}

export async function setMigrationPlanStatus(
  client: pg.Pool | pg.PoolClient,
  migrationId: string,
  status: MigrationPlanStatus,
): Promise<void> {
  await client.query(`UPDATE catalog.migration_plans SET status = $2, updated_at = now() WHERE migration_id = $1`, [migrationId, status]);
}

export async function insertMigrationSubscription(
  client: pg.Pool | pg.PoolClient,
  input: { migrationId: string; subscriptionId: string; organizationId: string; tenantId: string },
): Promise<MigrationSubscriptionRow> {
  const { rows } = await client.query<MigrationSubscriptionRow>(
    `INSERT INTO catalog.migration_subscriptions (migration_subscription_id, migration_id, subscription_id, organization_id, tenant_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (migration_id, subscription_id) DO NOTHING
     RETURNING *`,
    [generateMigrationSubscriptionId(), input.migrationId, input.subscriptionId, input.organizationId, input.tenantId],
  );
  return rows[0] as MigrationSubscriptionRow;
}

export async function listMigrationSubscriptions(
  migrationId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<MigrationSubscriptionRow[]> {
  const { rows } = await client.query<MigrationSubscriptionRow>(
    `SELECT * FROM catalog.migration_subscriptions WHERE migration_id = $1`,
    [migrationId],
  );
  return rows;
}

export async function setMigrationSubscriptionStatus(
  client: pg.Pool | pg.PoolClient,
  migrationSubscriptionId: string,
  status: MigrationSubscriptionStatus,
  fields: { migratedAt?: Date; failureReason?: string } = {},
): Promise<void> {
  await client.query(
    `UPDATE catalog.migration_subscriptions
     SET status = $2, migrated_at = COALESCE($3, migrated_at), failure_reason = COALESCE($4, failure_reason)
     WHERE migration_subscription_id = $1`,
    [migrationSubscriptionId, status, fields.migratedAt ?? null, fields.failureReason ?? null],
  );
}
