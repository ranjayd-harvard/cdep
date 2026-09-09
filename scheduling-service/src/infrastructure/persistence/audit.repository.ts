import { generateAuditEventId } from "../../common/ids/id-generator.js";
import type { SchedulerAuditEventType } from "../../config/constants.js";
import type { Queryable } from "./queryable.js";

export interface AuditEventInput {
  eventType: SchedulerAuditEventType;
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string | null;
  organizationId: string | null;
  tenantId: string | null;
  subscriptionId: string | null;
  executionId: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown>;
}

// Append-only (AGENTS.md section 40/59) — recorded for every meaningful
// step of the evaluation pipeline, not just terminal outcomes, so an
// operator can reconstruct exactly why a scheduled occurrence did or did
// not result in a PublicationRequest.
export async function recordAuditEvent(db: Queryable, input: AuditEventInput): Promise<void> {
  await db.query(
    `INSERT INTO scheduler_audit_events (
       id, event_type, actor_type, actor_id, organization_id, tenant_id,
       subscription_id, execution_id, correlation_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      generateAuditEventId(),
      input.eventType,
      input.actorType,
      input.actorId,
      input.organizationId,
      input.tenantId,
      input.subscriptionId,
      input.executionId,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export interface AuditEventRecord {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  organizationId: string | null;
  tenantId: string | null;
  subscriptionId: string | null;
  executionId: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export async function listAuditEventsForExecution(db: Queryable, executionId: string): Promise<AuditEventRecord[]> {
  const { rows } = await db.query<{
    id: string;
    event_type: string;
    actor_type: string;
    actor_id: string | null;
    organization_id: string | null;
    tenant_id: string | null;
    subscription_id: string | null;
    execution_id: string | null;
    correlation_id: string | null;
    metadata: Record<string, unknown>;
    occurred_at: Date;
  }>(`SELECT * FROM scheduler_audit_events WHERE execution_id = $1 ORDER BY occurred_at ASC`, [executionId]);
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    metadata: row.metadata,
    occurredAt: row.occurred_at,
  }));
}
