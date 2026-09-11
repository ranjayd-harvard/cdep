import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { EventEnvelope } from "../dto/event-envelope.dto.js";
import { eventEnvelopeSchema } from "../dto/event-envelope.dto.js";
import { generateStageRunId } from "../../common/ids/id-generator.js";
import { logger } from "../../common/logger/logger.js";
import { TERMINAL_STATUSES } from "../../config/constants.js";
import { pool } from "../../database/pool.js";
import { resolveOrCreateExecution } from "./correlation.service.js";
import { insertEventIfAbsent } from "../../infrastructure/persistence/event.repository.js";
import { listStageRunsForExecution, upsertStageRun, type StageRunRow } from "../../infrastructure/persistence/stage-run.repository.js";
import { updateExecutionRollup } from "../../infrastructure/persistence/execution.repository.js";
import { deriveExecutionState } from "../../domain/execution.js";
import { evaluateMetricsForStage } from "./metrics-evaluation.service.js";
import { evaluateSlaForExecution } from "./sla-evaluation.service.js";
import { evaluateHealthForExecution } from "./health-evaluation.service.js";
import { evaluateAlertsForExecution } from "./alert-evaluation.service.js";
import { syncSlaDefinitionsFromCatalog } from "./catalog-sla-sync.service.js";
import { increment } from "../../telemetry/metrics-registry.js";

function toStageRunView(row: StageRunRow) {
  return { stage: row.stage, status: row.status, attemptNumber: row.attemptNumber, startedAt: row.startedAt, completedAt: row.completedAt };
}

export interface IngestResult {
  status: "PERSISTED" | "DUPLICATE" | "REJECTED";
  executionId: string | null;
  errors?: unknown;
}

// The single event-ingestion pipeline (spec section 8's nine verbs) shared
// by both entry points: POST /v1/events (push) and every poller/normalizer
// (pull). validate -> dedupe -> normalize (already done by the caller) ->
// correlate -> persist -> update execution -> evaluate metrics -> evaluate
// SLA -> evaluate alerts (which also triggers health, since health depends
// on SLA/alert state).
export async function ingestEvent(rawEnvelope: unknown, catalogClient: CatalogClient): Promise<IngestResult> {
  const parsed = eventEnvelopeSchema.safeParse(rawEnvelope);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "event-ingestion.validation_failed");
    return { status: "REJECTED", executionId: null, errors: parsed.error.flatten() };
  }
  return ingestParsedEvent(parsed.data, catalogClient);
}

export async function ingestParsedEvent(envelope: EventEnvelope, catalogClient: CatalogClient): Promise<IngestResult> {
  const occurredAt = new Date(envelope.occurredAt);
  const now = new Date();

  const client = await pool.connect();
  let executionId: string;
  try {
    await client.query("BEGIN");

    const correlation = await resolveOrCreateExecution(client, envelope);
    executionId = correlation.executionId;

    const inserted = await insertEventIfAbsent(client, {
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      organizationId: envelope.context.organizationId,
      tenantId: envelope.context.tenantId,
      executionId,
      dataProductId: envelope.context.dataProductId,
      productVersion: envelope.context.productVersion,
      stage: envelope.operation.stage ?? null,
      status: envelope.operation.status ?? null,
      attemptNumber: envelope.operation.attempt,
      durationMs: envelope.metrics.durationMs ?? null,
      sourceService: envelope.source.service,
      sourceEntityType: envelope.source.entityType ?? null,
      sourceEntityId: envelope.source.entityId ?? null,
      correlationId: envelope.correlation.correlationId ?? null,
      traceId: envelope.correlation.traceId ?? null,
      occurredAt,
      metadataJson: envelope.metadata,
    });

    if (!inserted) {
      await client.query("COMMIT");
      return { status: "DUPLICATE", executionId };
    }

    if (envelope.operation.stage && envelope.operation.status) {
      const isTerminal = TERMINAL_STATUSES.includes(envelope.operation.status);
      await upsertStageRun(client, {
        stageRunId: generateStageRunId(),
        executionId,
        stage: envelope.operation.stage,
        status: envelope.operation.status,
        sourceService: envelope.source.service,
        sourceEntityId: envelope.source.entityId ?? null,
        attemptNumber: envelope.operation.attempt,
        startedAt: isTerminal ? null : occurredAt,
        completedAt: isTerminal ? occurredAt : null,
        durationMs: envelope.metrics.durationMs ?? null,
        errorCategory: envelope.operation.errorCategory ?? null,
        errorCode: envelope.operation.errorCode ?? null,
        errorMessage: envelope.operation.errorMessage ?? null,
        metadataJson: envelope.metadata,
      });

      const stageRuns = await listStageRunsForExecution(client, executionId);
      const derived = deriveExecutionState(stageRuns.map(toStageRunView));
      await updateExecutionRollup(client, executionId, {
        startedAt: derived.startedAt,
        completedAt: derived.completedAt,
        currentStage: derived.currentStage,
        overallStatus: derived.overallStatus,
      });

      if (derived.overallStatus === "FAILED") increment("operational_execution_failure_total");
      if (envelope.operation.stage === "PUBLICATION" && envelope.operation.status === "FAILED") {
        increment("publication_failure_total");
      }
    }

    if (correlation.isNewExecution) increment("operational_execution_total");

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Downstream evaluation (metrics/SLA/health/alerts) runs in its own
  // short transactions after the ingestion transaction commits — never
  // holding the ingestion row lock while calling out or doing heavier
  // reads, same discipline as scheduling-service's withTransaction comment.
  try {
    await syncSlaDefinitionsFromCatalog(pool, catalogClient, envelope.context.dataProductId, envelope.context.productVersion, now);
  } catch (err) {
    logger.warn({ err, dataProductId: envelope.context.dataProductId }, "catalog-sla-sync failed; continuing with cached definitions");
  }

  if (envelope.operation.stage) {
    await evaluateMetricsForStage(pool, executionId, envelope.operation.stage, now);
  }
  await evaluateSlaForExecution(pool, executionId, now);
  await evaluateHealthForExecution(pool, executionId);
  await evaluateAlertsForExecution(pool, executionId, now);

  return { status: "PERSISTED", executionId };
}
