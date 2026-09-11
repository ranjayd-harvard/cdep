import type pg from "pg";
import { generateExecutionId } from "../../common/ids/id-generator.js";
import type { DeliveryMethod, ExecutionReason, ExecutionStatus, FailureCategory, IneligibilityReasonCode } from "../../config/constants.js";
import type { ScheduledExecution } from "../../domain/execution.js";
import type { Queryable } from "./queryable.js";

interface ExecutionRow {
  id: string;
  execution_key: string;
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  reason: ExecutionReason;
  scheduled_for: Date;
  triggered_at: Date | null;
  requested_version_policy_type: string | null;
  requested_version_policy_value: string | null;
  resolved_product_version: string | null;
  delivery_method: DeliveryMethod | null;
  format: string | null;
  status: ExecutionStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: Date | null;
  publication_request_id: string | null;
  publication_id: string | null;
  failure_category: FailureCategory | null;
  failure_code: string | null;
  failure_message: string | null;
  ineligibility_reason_code: IneligibilityReasonCode | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

function mapRow(row: ExecutionRow): ScheduledExecution {
  return {
    id: row.id,
    executionKey: row.execution_key,
    subscriptionId: row.subscription_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    reason: row.reason,
    scheduledFor: row.scheduled_for,
    triggeredAt: row.triggered_at,
    requestedVersionPolicyType: row.requested_version_policy_type,
    requestedVersionPolicyValue: row.requested_version_policy_value,
    resolvedProductVersion: row.resolved_product_version,
    deliveryMethod: row.delivery_method,
    format: row.format,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    publicationRequestId: row.publication_request_id,
    publicationId: row.publication_id,
    failureCategory: row.failure_category,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    ineligibilityReasonCode: row.ineligibility_reason_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export interface InsertExecutionInput {
  executionKey: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  reason: ExecutionReason;
  scheduledFor: Date;
  requestedVersionPolicyType: string | null;
  requestedVersionPolicyValue: string | null;
  maxAttempts: number;
}

// Idempotent insert (AGENTS.md section 12/34): ON CONFLICT (execution_key)
// DO NOTHING means a duplicate due-scan, a restart, or two racing scheduler
// processes all converge on the same row rather than erroring or
// duplicating. The caller always re-selects by key afterward to get the
// authoritative row either way.
export async function insertExecutionIfAbsent(db: Queryable, input: InsertExecutionInput): Promise<ScheduledExecution> {
  await db.query(
    `INSERT INTO scheduled_execution (
       id, execution_key, subscription_id, organization_id, tenant_id, data_product_id,
       reason, scheduled_for, requested_version_policy_type, requested_version_policy_value,
       status, attempt_count, max_attempts
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', 0, $11)
     ON CONFLICT (execution_key) DO NOTHING`,
    [
      generateExecutionId(),
      input.executionKey,
      input.subscriptionId,
      input.organizationId,
      input.tenantId,
      input.dataProductId,
      input.reason,
      input.scheduledFor,
      input.requestedVersionPolicyType,
      input.requestedVersionPolicyValue,
      input.maxAttempts,
    ],
  );
  const existing = await findExecutionByKey(db, input.executionKey);
  if (!existing) throw new Error(`Failed to insert or find execution for key '${input.executionKey}'.`);
  return existing;
}

// Internal-only lookup (spec §11/M5) — no tenant filter. Never call from a
// customer-facing (requireAuth()) route; use findExecutionByIdForTenant
// there instead, which is WHERE-filtered at the SQL layer rather than
// relying on an app-layer post-fetch ownership check.
export async function findExecutionById(db: Queryable, id: string): Promise<ScheduledExecution | null> {
  const { rows } = await db.query<ExecutionRow>(`SELECT * FROM scheduled_execution WHERE id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findExecutionByIdForTenant(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  id: string,
): Promise<ScheduledExecution | null> {
  const { rows } = await db.query<ExecutionRow>(
    `SELECT * FROM scheduled_execution WHERE id = $1 AND organization_id = $2 AND tenant_id = $3`,
    [id, organizationId, tenantId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findExecutionByKey(db: Queryable, executionKey: string): Promise<ScheduledExecution | null> {
  const { rows } = await db.query<ExecutionRow>(`SELECT * FROM scheduled_execution WHERE execution_key = $1`, [executionKey]);
  return rows[0] ? mapRow(rows[0]) : null;
}

// Atomic claim (AGENTS.md section 34): FOR UPDATE SKIP LOCKED inside the
// subquery so two scheduler processes racing the same tick never both
// claim the same execution; the outer UPDATE both claims and transitions
// to EVALUATING in one statement. attempt_count increments here — every
// claimed processing attempt counts toward max_attempts, whether it fails
// during subscription/entitlement/catalog revalidation or at actual
// Publication Service dispatch, so a permanently-unreachable dependency
// still terminal-fails/dead-letters rather than retrying forever.
export async function claimReadyExecutions(client: pg.PoolClient, now: Date, limit: number): Promise<ScheduledExecution[]> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution
     SET status = 'EVALUATING', attempt_count = attempt_count + 1, triggered_at = COALESCE(triggered_at, now()), updated_at = now()
     WHERE id IN (
       SELECT id FROM scheduled_execution
       WHERE status = 'PENDING' OR (status = 'RETRY_WAIT' AND next_retry_at <= $1)
       ORDER BY COALESCE(next_retry_at, created_at) ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [now, limit],
  );
  return rows.map(mapRow);
}

// Single-row variant of claimReadyExecutions, used by ManualTriggerService
// to process a just-inserted (or already-PENDING) execution immediately
// rather than waiting for the next scan tick, while staying race-safe
// against a concurrent background claim of the same row: a single-row
// conditional UPDATE is atomic, so at most one caller ever wins it.
export async function claimSpecificExecution(client: pg.PoolClient, id: string, now: Date): Promise<ScheduledExecution | null> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution
     SET status = 'EVALUATING', attempt_count = attempt_count + 1, triggered_at = COALESCE(triggered_at, now()), updated_at = now()
     WHERE id = $1 AND (status = 'PENDING' OR (status = 'RETRY_WAIT' AND next_retry_at <= $2))
     RETURNING *`,
    [id, now],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function markSkipped(client: pg.PoolClient, id: string, reasonCode: IneligibilityReasonCode, message: string): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution
     SET status = 'SKIPPED', ineligibility_reason_code = $2, failure_message = $3, completed_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, reasonCode, message],
  );
  return mapRow(rows[0] as ExecutionRow);
}

export interface MarkEligibleInput {
  resolvedProductVersion: string;
  deliveryMethod: DeliveryMethod;
  format: string | null;
}

export async function markEligible(client: pg.PoolClient, id: string, input: MarkEligibleInput): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution
     SET status = 'ELIGIBLE', resolved_product_version = $2, delivery_method = $3, format = $4, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, input.resolvedProductVersion, input.deliveryMethod, input.format],
  );
  return mapRow(rows[0] as ExecutionRow);
}

export async function markDispatching(client: pg.PoolClient, id: string, publicationRequestId: string): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution SET status = 'DISPATCHING', publication_request_id = $2, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, publicationRequestId],
  );
  return mapRow(rows[0] as ExecutionRow);
}

export async function markSucceeded(client: pg.PoolClient, id: string, publicationId: string): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution SET status = 'SUCCEEDED', publication_id = $2, completed_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, publicationId],
  );
  return mapRow(rows[0] as ExecutionRow);
}

export interface MarkFailureInput {
  failureCategory: FailureCategory;
  failureCode: string | null;
  failureMessage: string;
}

export async function markRetryWait(client: pg.PoolClient, id: string, input: MarkFailureInput & { nextRetryAt: Date }): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution
     SET status = 'RETRY_WAIT', next_retry_at = $2, failure_category = $3, failure_code = $4, failure_message = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, input.nextRetryAt, input.failureCategory, input.failureCode, input.failureMessage],
  );
  return mapRow(rows[0] as ExecutionRow);
}

export async function markTerminalFailed(client: pg.PoolClient, id: string, input: MarkFailureInput): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution
     SET status = 'TERMINAL_FAILED', failure_category = $2, failure_code = $3, failure_message = $4, completed_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, input.failureCategory, input.failureCode, input.failureMessage],
  );
  return mapRow(rows[0] as ExecutionRow);
}

export async function markDeadLettered(client: pg.PoolClient, id: string): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution SET status = 'DEAD_LETTERED', updated_at = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  return mapRow(rows[0] as ExecutionRow);
}

// Operator-driven, preserves execution_key/scheduled_for (AGENTS.md section
// 42) — a redrive re-enters the exact same logical execution, never a new
// one. attempt_count resets so the operator gets a fresh full retry budget
// for this deliberate re-attempt.
export async function resetForRedrive(client: pg.PoolClient, id: string): Promise<ScheduledExecution> {
  const { rows } = await client.query<ExecutionRow>(
    `UPDATE scheduled_execution
     SET status = 'PENDING', attempt_count = 0, next_retry_at = NULL, completed_at = NULL, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id],
  );
  return mapRow(rows[0] as ExecutionRow);
}

export interface ExecutionFilter {
  status?: ExecutionStatus;
  subscriptionId?: string;
  organizationId?: string;
  tenantId?: string;
  dataProductId?: string;
  reason?: ExecutionReason;
  scheduledFrom?: Date;
  scheduledTo?: Date;
  limit?: number;
  offset?: number;
}

export interface ExecutionPage {
  items: ScheduledExecution[];
  hasMore: boolean;
}

// Tenant scoping is always applied by the caller passing organizationId +
// tenantId here (AGENTS.md section 45) — never left optional for a
// customer-facing route.
export async function listExecutions(db: Queryable, filter: ExecutionFilter): Promise<ExecutionPage> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  function add(column: string, value: unknown) {
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  }

  if (filter.status) add("status", filter.status);
  if (filter.subscriptionId) add("subscription_id", filter.subscriptionId);
  if (filter.organizationId) add("organization_id", filter.organizationId);
  if (filter.tenantId) add("tenant_id", filter.tenantId);
  if (filter.dataProductId) add("data_product_id", filter.dataProductId);
  if (filter.reason) add("reason", filter.reason);
  if (filter.scheduledFrom) {
    params.push(filter.scheduledFrom);
    conditions.push(`scheduled_for >= $${params.length}`);
  }
  if (filter.scheduledTo) {
    params.push(filter.scheduledTo);
    conditions.push(`scheduled_for <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  params.push(limit + 1, offset);

  const { rows } = await db.query<ExecutionRow>(
    `SELECT * FROM scheduled_execution ${where} ORDER BY scheduled_for DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map(mapRow), hasMore };
}
