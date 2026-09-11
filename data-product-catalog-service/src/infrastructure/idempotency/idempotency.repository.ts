import type pg from "pg";

// Phase 10 §43: ported from subscription-service's idempotency.repository.ts
// (same shape, same wrapper function signature), with organization_id/
// tenant_id replaced by a single `scope` — Catalog's idempotent operations
// (currently just migration-plan creation) are scoped to a data_product_id,
// not a tenant.
export interface IdempotencyRecord {
  idempotencyKey: string;
  scope: string;
  operation: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  resourceId: string | null;
}

interface IdempotencyRow {
  idempotency_key: string;
  scope: string;
  operation: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
  resource_id: string | null;
}

function mapRow(row: IdempotencyRow): IdempotencyRecord {
  return {
    idempotencyKey: row.idempotency_key,
    scope: row.scope,
    operation: row.operation,
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    resourceId: row.resource_id,
  };
}

export async function findIdempotencyRecord(
  db: pg.Pool | pg.PoolClient,
  scope: string,
  operation: string,
  idempotencyKey: string,
): Promise<IdempotencyRecord | null> {
  const { rows } = await db.query<IdempotencyRow>(
    `SELECT * FROM catalog.idempotency_records
     WHERE idempotency_key = $1 AND scope = $2 AND operation = $3
       AND expires_at > now()`,
    [idempotencyKey, scope, operation],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface SaveIdempotencyRecordInput {
  idempotencyKey: string;
  scope: string;
  operation: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  resourceId: string | null;
  ttlHours: number;
}

export async function saveIdempotencyRecord(db: pg.Pool | pg.PoolClient, input: SaveIdempotencyRecordInput): Promise<void> {
  await db.query(
    `INSERT INTO catalog.idempotency_records (
       idempotency_key, scope, operation, request_hash,
       response_status, response_body, resource_id, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' hours')::interval)`,
    [
      input.idempotencyKey,
      input.scope,
      input.operation,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.responseBody),
      input.resourceId,
      input.ttlHours,
    ],
  );
}
