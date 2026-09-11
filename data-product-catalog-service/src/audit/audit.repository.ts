import type pg from "pg";
import { pool } from "../database/pool.js";
import { generateAuditEventId } from "../common/ids/id-generator.js";
import type { SecurityEventType } from "../config/constants.js";

export interface AuditEventInput {
  eventType: SecurityEventType;
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string | null;
  organizationId?: string | null;
  tenantId?: string | null;
  resourceType: string | null;
  resourceId: string | null;
  decision?: "ALLOW" | "DENY" | null;
  reasonCode?: string | null;
  correlationId: string | null;
  metadata?: Record<string, unknown>;
}

// Append-only (spec §28/§29) — this service has no distinct least-privilege
// application role yet (see docs/security/tenant-isolation.md), so unlike
// data-exchange-service's equivalent table there is no DB-level UPDATE/
// DELETE restriction today; this function is nonetheless the only code
// path in this service that writes to this table.
export async function recordSecurityAuditEvent(
  input: AuditEventInput,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog.security_audit_events (
       event_id, event_type, actor_type, actor_id, organization_id, tenant_id,
       resource_type, resource_id, decision, reason_code, correlation_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      generateAuditEventId(),
      input.eventType,
      input.actorType,
      input.actorId,
      input.organizationId ?? null,
      input.tenantId ?? null,
      input.resourceType,
      input.resourceId,
      input.decision ?? null,
      input.reasonCode ?? null,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
