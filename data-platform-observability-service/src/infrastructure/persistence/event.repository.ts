import type pg from "pg";
import type { OperationalStage, OperationalStatus } from "../../config/constants.js";

export interface InsertEventParams {
  eventId: string;
  eventType: string;
  organizationId: string;
  tenantId: string;
  executionId: string | null;
  dataProductId: string;
  productVersion: string;
  stage: OperationalStage | null;
  status: OperationalStatus | null;
  attemptNumber: number;
  durationMs: number | null;
  sourceService: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  correlationId: string | null;
  traceId: string | null;
  occurredAt: Date;
  metadataJson: Record<string, unknown>;
}

// The entire idempotency mechanism for duplicate/late/replayed events (plan
// section 4): event_id is the SOURCE's own identifier, never generated
// here, so ON CONFLICT DO NOTHING is sufficient — a duplicate is silently
// absorbed and the caller is told nothing new was inserted.
export async function insertEventIfAbsent(client: pg.Pool | pg.PoolClient, params: InsertEventParams): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO operational_events
       (event_id, event_type, organization_id, tenant_id, execution_id, data_product_id, product_version,
        stage, status, attempt_number, duration_ms, source_service, source_entity_type, source_entity_id,
        correlation_id, trace_id, occurred_at, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      params.eventId,
      params.eventType,
      params.organizationId,
      params.tenantId,
      params.executionId,
      params.dataProductId,
      params.productVersion,
      params.stage,
      params.status,
      params.attemptNumber,
      params.durationMs,
      params.sourceService,
      params.sourceEntityType,
      params.sourceEntityId,
      params.correlationId,
      params.traceId,
      params.occurredAt,
      params.metadataJson,
    ],
  );
  return (rowCount ?? 0) > 0;
}

export async function findMostRecentEventTime(
  client: pg.Pool | pg.PoolClient,
  scope: { tenantId: string; dataProductId: string },
): Promise<Date | null> {
  const { rows } = await client.query<{ occurred_at: Date | null }>(
    `SELECT MAX(occurred_at) AS occurred_at FROM operational_events WHERE tenant_id = $1 AND data_product_id = $2`,
    [scope.tenantId, scope.dataProductId],
  );
  return rows[0]?.occurred_at ?? null;
}
