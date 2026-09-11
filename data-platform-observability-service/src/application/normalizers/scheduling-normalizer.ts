import type { EventEnvelope } from "../dto/event-envelope.dto.js";
import type { ScheduledExecutionRecord } from "../../ports/scheduling-client.port.js";
import type { OperationalStage, OperationalStatus } from "../../config/constants.js";

// scheduled_execution has no dedicated normalized stage of its own — it
// establishes execution identity/context (subscription_id, scheduled_run_id)
// ahead of any pipeline stage event, and only produces a stage signal when
// the scheduler itself gives up before ever reaching publication
// (TERMINAL_FAILED/DEAD_LETTERED) or explicitly cancels/skips a run —
// legitimately reported as a PUBLICATION-stage outcome since, from the
// platform's perspective, publication was never successfully attempted.
export function normalizeScheduledExecution(record: ScheduledExecutionRecord): EventEnvelope {
  const terminalFailure = record.status === "TERMINAL_FAILED" || record.status === "DEAD_LETTERED";
  const cancelled = record.status === "SKIPPED" || record.status === "CANCELLED";

  const stage: OperationalStage | null = terminalFailure || cancelled ? "PUBLICATION" : null;
  const status: OperationalStatus | null = terminalFailure ? "FAILED" : cancelled ? "CANCELLED" : null;

  const occurredAt = record.scheduledFor ?? new Date();

  return {
    eventId: `scheduling:${record.scheduledRunId}:${record.status}`,
    eventType: `SCHEDULED_EXECUTION_${record.status}`,
    occurredAt: occurredAt.toISOString(),
    source: { service: "scheduling-service", entityType: "scheduled_execution", entityId: record.scheduledRunId },
    context: {
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      dataProductId: record.dataProductId,
      // Not yet resolved for early-lifecycle statuses (PENDING/EVALUATING) —
      // "unknown" is a valid scope value here, never fabricated as a guess.
      productVersion: record.resolvedProductVersion ?? "unknown",
      subscriptionId: record.subscriptionId,
      scheduledRunId: record.scheduledRunId,
    },
    correlation: { publicationId: record.publicationId ?? undefined },
    operation: {
      stage,
      status,
      attempt: 1,
      errorCategory: record.failureCategory ?? undefined,
      errorCode: record.failureCode ?? undefined,
    },
    metrics: {},
    metadata: { schedulingStatus: record.status },
  };
}
