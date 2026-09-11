import type { EventEnvelope } from "../dto/event-envelope.dto.js";
import type { IngestionRunRow, PipelineRunRow, QualityResultRow } from "../../infrastructure/postgres/lakehouse-metadata-reader.js";
import type { OperationalStatus } from "../../config/constants.js";

// lakehouse.{ingestion_runs,pipeline_runs,quality_results}.status is a free
// string in that service (no shared enum was found in the repo) — mapped
// defensively here rather than assuming an exact vocabulary.
function mapLakehouseStatus(status: string): OperationalStatus {
  const upper = status.toUpperCase();
  if (upper.includes("SUCCEED") || upper === "COMPLETED" || upper === "DONE") return "SUCCEEDED";
  if (upper.includes("FAIL")) return "FAILED";
  if (upper.includes("CANCEL")) return "CANCELLED";
  if (upper.includes("RETRY")) return "RETRYING";
  if (upper.includes("RUNNING") || upper.includes("PROCESSING") || upper.includes("IN_PROGRESS")) return "RUNNING";
  if (upper.includes("PENDING") || upper.includes("QUEUED")) return "PENDING";
  return "UNKNOWN";
}

export function normalizeIngestionRun(row: IngestionRunRow, productVersion: string): EventEnvelope {
  const status = mapLakehouseStatus(row.status);
  const occurredAt = row.completedAt ?? row.startedAt ?? row.createdAt;
  return {
    eventId: `lakehouse-ingestion:${row.ingestionId}:${row.status}`,
    eventType: `BRONZE_INGESTION_${row.status}`,
    occurredAt: occurredAt.toISOString(),
    source: { service: "data-lakehouse", entityType: "ingestion_run", entityId: row.ingestionId },
    context: { organizationId: row.organizationId, tenantId: row.tenantId, dataProductId: row.dataProductId, productVersion },
    correlation: { inboundExchangeId: row.exchangeId ?? undefined, ingestionId: row.ingestionId },
    operation: { stage: "BRONZE_INGESTION", status, attempt: 1, errorCode: row.errorCode ?? undefined, errorMessage: row.errorMessage ?? undefined },
    metrics: {},
    metadata: {
      sourceRecordCount: row.sourceRecordCount,
      bronzeRecordCount: row.bronzeRecordCount,
      rejectedRecordCount: row.rejectedRecordCount,
    },
  };
}

export function normalizePipelineRun(row: PipelineRunRow): EventEnvelope {
  // contract_version is the closest lakehouse concept to catalog's semver
  // product_version; "unresolved" until a downstream publication event
  // (which always carries the real, catalog-resolved product_version)
  // backfills the execution's column via correlation.service.ts.
  const productVersion = row.contractVersion ?? "unresolved";
  const status = mapLakehouseStatus(row.status);
  const stage = row.pipelineType === "BRONZE_TO_SILVER" ? "SILVER_TRANSFORMATION" : "GOLD_PRODUCT_BUILD";
  const occurredAt = row.completedAt ?? row.startedAt ?? row.createdAt;

  const correlation: EventEnvelope["correlation"] = {};
  if (row.sourceExchangeId) correlation.inboundExchangeId = row.sourceExchangeId;
  if (row.sourceIngestionId) correlation.ingestionId = row.sourceIngestionId;
  if (row.pipelineType === "BRONZE_TO_SILVER") {
    correlation.silverPipelineRunId = row.pipelineRunId;
    if (row.sourcePipelineRunId) correlation.ingestionId = correlation.ingestionId ?? row.sourcePipelineRunId;
  } else {
    correlation.goldPipelineRunId = row.pipelineRunId;
    if (row.sourcePipelineRunId) correlation.silverPipelineRunId = row.sourcePipelineRunId;
  }

  return {
    eventId: `lakehouse-pipeline:${row.pipelineRunId}:${row.status}`,
    eventType: `${stage}_${row.status}`,
    occurredAt: occurredAt.toISOString(),
    source: { service: "data-lakehouse", entityType: "pipeline_run", entityId: row.pipelineRunId },
    context: { organizationId: row.organizationId, tenantId: row.tenantId, dataProductId: row.dataProductId, productVersion },
    correlation,
    operation: { stage, status, attempt: 1, errorCode: row.errorCode ?? undefined, errorMessage: row.errorMessage ?? undefined },
    metrics: {},
    metadata: {
      inputRecordCount: row.inputRecordCount,
      outputRecordCount: row.outputRecordCount,
      rejectedRecordCount: row.rejectedRecordCount,
    },
  };
}

// Quality results don't carry organization_id/tenant_id/data_product_id of
// their own (they key only on pipeline_run_id) — the caller (lakehouse
// poller) must supply that context, resolved from the pipeline_runs row the
// quality result belongs to.
export function normalizeQualityResult(
  row: QualityResultRow,
  context: { organizationId: string; tenantId: string; dataProductId: string; productVersion: string },
): EventEnvelope {
  const status: OperationalStatus = row.passed ? "SUCCEEDED" : row.severity?.toUpperCase() === "WARNING" ? "RUNNING" : "FAILED";
  return {
    eventId: `lakehouse-quality:${row.pipelineRunId}:${row.ruleName}:${row.evaluatedAt.getTime()}`,
    eventType: `QUALITY_${row.layer}_${row.ruleName}`,
    occurredAt: row.evaluatedAt.toISOString(),
    source: { service: "data-lakehouse", entityType: "quality_result", entityId: row.pipelineRunId },
    context,
    correlation: row.layer === "GOLD" ? { goldPipelineRunId: row.pipelineRunId } : { silverPipelineRunId: row.pipelineRunId },
    operation: { stage: "QUALITY_VALIDATION", status, attempt: 1 },
    metrics: {},
    metadata: {
      layer: row.layer,
      ruleName: row.ruleName,
      severity: row.severity,
      totalCount: row.totalCount,
      failedCount: row.failedCount,
      failurePercentage: row.failurePercentage,
    },
  };
}
