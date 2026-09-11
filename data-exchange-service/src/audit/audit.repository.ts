import type pg from "pg";
import { pool } from "../database/pool.js";
import { generateAuditEventId } from "../common/ids/id-generator.js";
import type { SecurityEventType } from "../config/constants.js";

export interface AuditEventInput {
  eventType: SecurityEventType;
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string | null;
  organizationId: string | null;
  tenantId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  decision?: "ALLOW" | "DENY" | null;
  reasonCode?: string | null;
  correlationId: string | null;
  metadata?: Record<string, unknown>;
}

// Append-only security/governance audit (spec §28/§29) — mirrors the
// pattern already established in scheduling-service/subscription-service's
// own audit tables. The application role (app_exchange) has no UPDATE/
// DELETE grant on this table (migrations/011_retention_and_audit.sql), so
// this function structurally can only ever add rows, never rewrite them.
export async function recordSecurityAuditEvent(
  input: AuditEventInput,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO exchange.security_audit_events (
       event_id, event_type, actor_type, actor_id, organization_id, tenant_id,
       resource_type, resource_id, decision, reason_code, correlation_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      generateAuditEventId(),
      input.eventType,
      input.actorType,
      input.actorId,
      input.organizationId,
      input.tenantId,
      input.resourceType,
      input.resourceId,
      input.decision ?? null,
      input.reasonCode ?? null,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
