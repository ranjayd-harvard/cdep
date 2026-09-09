import type pg from "pg";
import { generateDeadLetterId } from "../../common/ids/id-generator.js";
import type { FailureCategory } from "../../config/constants.js";
import type { DeadLetterRecord } from "../../domain/execution.js";
import type { Queryable } from "./queryable.js";

interface DeadLetterRow {
  id: string;
  execution_id: string;
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  failure_category: FailureCategory | null;
  failure_code: string | null;
  failure_message: string | null;
  attempt_count: number;
  payload_snapshot: Record<string, unknown>;
  dead_lettered_at: Date;
  resolved_at: Date | null;
  resolution_note: string | null;
}

function mapRow(row: DeadLetterRow): DeadLetterRecord {
  return {
    id: row.id,
    executionId: row.execution_id,
    subscriptionId: row.subscription_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    failureCategory: row.failure_category,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    attemptCount: row.attempt_count,
    payloadSnapshot: row.payload_snapshot,
    deadLetteredAt: row.dead_lettered_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
  };
}

export interface InsertDeadLetterInput {
  executionId: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  failureCategory: FailureCategory | null;
  failureCode: string | null;
  failureMessage: string | null;
  attemptCount: number;
  payloadSnapshot: Record<string, unknown>;
}

export async function insertDeadLetter(client: pg.PoolClient, input: InsertDeadLetterInput): Promise<DeadLetterRecord> {
  const { rows } = await client.query<DeadLetterRow>(
    `INSERT INTO scheduler_dead_letter (
       id, execution_id, subscription_id, organization_id, tenant_id,
       failure_category, failure_code, failure_message, attempt_count, payload_snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      generateDeadLetterId(),
      input.executionId,
      input.subscriptionId,
      input.organizationId,
      input.tenantId,
      input.failureCategory,
      input.failureCode,
      input.failureMessage,
      input.attemptCount,
      JSON.stringify(input.payloadSnapshot),
    ],
  );
  return mapRow(rows[0] as DeadLetterRow);
}

export async function findDeadLetterById(db: Queryable, id: string): Promise<DeadLetterRecord | null> {
  const { rows } = await db.query<DeadLetterRow>(`SELECT * FROM scheduler_dead_letter WHERE id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findDeadLetterByExecutionId(db: Queryable, executionId: string): Promise<DeadLetterRecord | null> {
  const { rows } = await db.query<DeadLetterRow>(`SELECT * FROM scheduler_dead_letter WHERE execution_id = $1 ORDER BY dead_lettered_at DESC LIMIT 1`, [executionId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface ListDeadLetterFilter {
  unresolvedOnly?: boolean;
  organizationId?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}

export interface DeadLetterPage {
  items: DeadLetterRecord[];
  hasMore: boolean;
}

export async function listDeadLetters(db: Queryable, filter: ListDeadLetterFilter): Promise<DeadLetterPage> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.unresolvedOnly) conditions.push("resolved_at IS NULL");
  if (filter.organizationId) {
    params.push(filter.organizationId);
    conditions.push(`organization_id = $${params.length}`);
  }
  if (filter.tenantId) {
    params.push(filter.tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  params.push(limit + 1, offset);

  const { rows } = await db.query<DeadLetterRow>(
    `SELECT * FROM scheduler_dead_letter ${where} ORDER BY dead_lettered_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map(mapRow), hasMore };
}

export async function markDeadLetterResolved(client: pg.PoolClient, id: string, resolutionNote: string | null): Promise<DeadLetterRecord> {
  const { rows } = await client.query<DeadLetterRow>(
    `UPDATE scheduler_dead_letter SET resolved_at = now(), resolution_note = $2 WHERE id = $1 RETURNING *`,
    [id, resolutionNote],
  );
  return mapRow(rows[0] as DeadLetterRow);
}
