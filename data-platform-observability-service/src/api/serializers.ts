import type { OperationalExecutionRow } from "../infrastructure/persistence/execution.repository.js";
import type { StageRunRow } from "../infrastructure/persistence/stage-run.repository.js";
import type { SlaEvaluationRow } from "../infrastructure/persistence/sla-evaluation.repository.js";
import type { AlertRow } from "../infrastructure/persistence/alert.repository.js";
import type { IncidentRow } from "../infrastructure/persistence/incident.repository.js";
import type { MaintenanceWindowRow } from "../infrastructure/persistence/maintenance-window.repository.js";
import type { TimelineEntry } from "../domain/timeline.js";
import type { HealthResult } from "../domain/health/health-score.js";
import type { FailedStageResult } from "../domain/failed-stage-detector.js";
import type { RetryRecommendation } from "../domain/retry-recommender.js";

export function serializeExecution(row: OperationalExecutionRow) {
  return {
    execution_id: row.executionId,
    organization_id: row.organizationId,
    tenant_id: row.tenantId,
    data_product_id: row.dataProductId,
    product_version: row.productVersion,
    subscription_id: row.subscriptionId,
    scheduled_run_id: row.scheduledRunId,
    inbound_exchange_id: row.inboundExchangeId,
    ingestion_id: row.ingestionId,
    silver_pipeline_run_id: row.silverPipelineRunId,
    gold_pipeline_run_id: row.goldPipelineRunId,
    publication_id: row.publicationId,
    outbound_exchange_id: row.outboundExchangeId,
    delivery_request_id: row.deliveryRequestId,
    api_request_id: row.apiRequestId,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    current_stage: row.currentStage,
    overall_status: row.overallStatus,
    technical_sla_status: row.technicalSlaStatus,
    business_sla_status: row.businessSlaStatus,
    health_status: row.healthStatus,
    correlation_id: row.correlationId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function serializeStageRun(row: StageRunRow) {
  return {
    stage_run_id: row.stageRunId,
    execution_id: row.executionId,
    stage: row.stage,
    status: row.status,
    source_service: row.sourceService,
    source_entity_id: row.sourceEntityId,
    attempt_number: row.attemptNumber,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    duration_ms: row.durationMs,
    error_category: row.errorCategory,
    error_code: row.errorCode,
    error_message: row.errorMessage,
  };
}

export function serializeSlaEvaluation(row: SlaEvaluationRow) {
  return {
    sla_evaluation_id: row.slaEvaluationId,
    execution_id: row.executionId,
    sla_definition_id: row.slaDefinitionId,
    data_product_id: row.dataProductId,
    product_version: row.productVersion,
    sla_type: row.slaType,
    stage: row.stage,
    status: row.status,
    target_value: row.targetValue,
    actual_value: row.actualValue,
    breach_duration_seconds: row.breachDurationSeconds,
    evaluated_at: row.evaluatedAt,
  };
}

export function serializeAlert(row: AlertRow) {
  return {
    alert_id: row.alertId,
    alert_type: row.alertType,
    severity: row.severity,
    state: row.state,
    data_product_id: row.dataProductId,
    product_version: row.productVersion,
    execution_id: row.executionId,
    title: row.title,
    description: row.description,
    opened_at: row.openedAt,
    acknowledged_at: row.acknowledgedAt,
    resolved_at: row.resolvedAt,
    suppressed_until: row.suppressedUntil,
    incident_id: row.incidentId,
  };
}

export function serializeIncident(row: IncidentRow) {
  return {
    incident_id: row.incidentId,
    data_product_id: row.dataProductId,
    product_version: row.productVersion,
    title: row.title,
    severity: row.severity,
    state: row.state,
    opened_at: row.openedAt,
    resolved_at: row.resolvedAt,
  };
}

export function serializeMaintenanceWindow(row: MaintenanceWindowRow) {
  return {
    maintenance_window_id: row.maintenanceWindowId,
    scope: row.scope,
    scope_value: row.scopeValue,
    starts_at: row.startsAt,
    ends_at: row.endsAt,
    reason: row.reason,
    created_by: row.createdBy,
  };
}

export function serializeTimelineEntry(entry: TimelineEntry) {
  return {
    timestamp: entry.timestamp,
    stage: entry.stage,
    status: entry.status,
    source_service: entry.sourceService,
    source_entity_id: entry.sourceEntityId,
    duration_ms: entry.durationMs,
    message: entry.message,
  };
}

export function serializeHealth(result: HealthResult) {
  return {
    status: result.status,
    score: result.score,
    component_scores: result.componentScores,
  };
}

export function serializeFailedStage(result: FailedStageResult) {
  return {
    failed_stage: result.failedStage,
    downstream_blocked: result.downstreamBlocked,
    never_started_stages: result.neverStartedStages,
  };
}

export function serializeRetryRecommendation(result: RetryRecommendation) {
  return {
    execution_id: result.executionId,
    failed_stage: result.failedStage,
    retry_recommended: result.retryRecommended,
    retry_owner: result.retryOwner,
    reason: result.reason,
    safe_from_stage: result.safeFromStage,
  };
}
