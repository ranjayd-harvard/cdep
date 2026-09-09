import type { DeadLetterRecord, ScheduledExecution, SchedulerProjection } from "../domain/execution.js";

// Wire-format serializers: snake_case on the wire, camelCase internally —
// mirrors subscription-service's api/serializers.ts convention.

export function serializeExecution(execution: ScheduledExecution) {
  return {
    execution_id: execution.id,
    execution_key: execution.executionKey,
    subscription_id: execution.subscriptionId,
    organization_id: execution.organizationId,
    tenant_id: execution.tenantId,
    data_product_id: execution.dataProductId,
    reason: execution.reason,
    scheduled_for: execution.scheduledFor,
    triggered_at: execution.triggeredAt,
    requested_version_policy: {
      type: execution.requestedVersionPolicyType,
      value: execution.requestedVersionPolicyValue,
    },
    resolved_product_version: execution.resolvedProductVersion,
    delivery_method: execution.deliveryMethod,
    format: execution.format,
    status: execution.status,
    attempt_count: execution.attemptCount,
    max_attempts: execution.maxAttempts,
    next_retry_at: execution.nextRetryAt,
    publication_request_id: execution.publicationRequestId,
    publication_id: execution.publicationId,
    failure_category: execution.failureCategory,
    failure_code: execution.failureCode,
    failure_message: execution.failureMessage,
    ineligibility_reason_code: execution.ineligibilityReasonCode,
    created_at: execution.createdAt,
    updated_at: execution.updatedAt,
    completed_at: execution.completedAt,
  };
}

export function serializeDeadLetter(record: DeadLetterRecord) {
  return {
    dead_letter_id: record.id,
    execution_id: record.executionId,
    subscription_id: record.subscriptionId,
    organization_id: record.organizationId,
    tenant_id: record.tenantId,
    failure_category: record.failureCategory,
    failure_code: record.failureCode,
    failure_message: record.failureMessage,
    attempt_count: record.attemptCount,
    payload_snapshot: record.payloadSnapshot,
    dead_lettered_at: record.deadLetteredAt,
    resolved_at: record.resolvedAt,
    resolution_note: record.resolutionNote,
  };
}

export function serializeProjection(projection: SchedulerProjection) {
  return {
    subscription_id: projection.subscriptionId,
    status: projection.subscriptionStatus,
    schedule_mode: projection.scheduleMode,
    timezone: projection.timezone,
    next_scheduled_run: projection.nextRunAt,
  };
}
