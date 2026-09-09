import type { Queryable } from "../persistence/queryable.js";

export interface IdempotencyRecord {
  idempotencyKey: string;
  organizationId: string;
  tenantId: string;
  operation: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  resourceId: string | null;
}

interface IdempotencyRow {
  idempotency_key: string;
  organization_id: string;
  tenant_id: string;
  operation: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
  resource_id: string | null;
}

function mapRow(row: IdempotencyRow): IdempotencyRecord {
  return {
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    operation: row.operation,
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    resourceId: row.resource_id,
  };
}

export async function findIdempotencyRecord(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
): Promise<IdempotencyRecord | null> {
  const { rows } = await db.query<IdempotencyRow>(
    `SELECT * FROM idempotency_records
     WHERE idempotency_key = $1 AND organization_id = $2 AND tenant_id = $3 AND operation = $4
       AND expires_at > now()`,
    [idempotencyKey, organizationId, tenantId, operation],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface SaveIdempotencyRecordInput {
  idempotencyKey: string;
  organizationId: string;
  tenantId: string;
  operation: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  resourceId: string | null;
  ttlHours: number;
}

export async function saveIdempotencyRecord(db: Queryable, input: SaveIdempotencyRecordInput): Promise<void> {
  await db.query(
    `INSERT INTO idempotency_records (
       idempotency_key, organization_id, tenant_id, operation, request_hash,
       response_status, response_body, resource_id, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9 || ' hours')::interval)`,
    [
      input.idempotencyKey,
      input.organizationId,
      input.tenantId,
      input.operation,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.responseBody),
      input.resourceId,
      input.ttlHours,
    ],
  );
}
