import { generateAuditEventId } from "../../common/ids/id-generator.js";
import type { AuditAction } from "../../config/constants.js";
import type { Queryable } from "./queryable.js";

export interface AuditEventInput {
  organizationId: string;
  tenantId: string;
  entityType: "ENTITLEMENT" | "SUBSCRIPTION";
  entityId: string;
  action: AuditAction;
  previousState: unknown;
  newState: unknown;
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string;
  correlationId: string | null;
  idempotencyKey: string | null;
}

// Append-only (spec §40) — always written inside the same transaction as
// the state mutation it records (spec §41), never as best-effort logging.
export async function recordAuditEvent(db: Queryable, input: AuditEventInput): Promise<void> {
  await db.query(
    `INSERT INTO subscription_audit_events (
       audit_event_id, organization_id, tenant_id, entity_type, entity_id,
       action, previous_state, new_state, actor_type, actor_id,
       correlation_id, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      generateAuditEventId(),
      input.organizationId,
      input.tenantId,
      input.entityType,
      input.entityId,
      input.action,
      input.previousState ? JSON.stringify(input.previousState) : null,
      input.newState ? JSON.stringify(input.newState) : null,
      input.actorType,
      input.actorId,
      input.correlationId,
      input.idempotencyKey,
    ],
  );
}

export interface AuditEventRecord {
  auditEventId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousState: unknown;
  newState: unknown;
  actorType: string;
  actorId: string | null;
  correlationId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export async function listAuditEventsForEntity(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  entityType: "ENTITLEMENT" | "SUBSCRIPTION",
  entityId: string,
): Promise<AuditEventRecord[]> {
  const { rows } = await db.query<{
    audit_event_id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    previous_state: unknown;
    new_state: unknown;
    actor_type: string;
    actor_id: string | null;
    correlation_id: string | null;
    idempotency_key: string | null;
    created_at: Date;
  }>(
    `SELECT * FROM subscription_audit_events
     WHERE organization_id = $1 AND tenant_id = $2 AND entity_type = $3 AND entity_id = $4
     ORDER BY created_at DESC`,
    [organizationId, tenantId, entityType, entityId],
  );
  return rows.map((row) => ({
    auditEventId: row.audit_event_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    previousState: row.previous_state,
    newState: row.new_state,
    actorType: row.actor_type,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  }));
}
