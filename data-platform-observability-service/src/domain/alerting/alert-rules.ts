import type { AlertSeverity, AlertType, SlaStatus } from "../../config/constants.js";
import type { StageRunView } from "../execution.js";

export interface AlertCandidate {
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  // Execution-scoped rules key on the execution_id; aggregate rules
  // (no-data-received, API availability) key on a caller-supplied window
  // bucket string instead — see computeAlertDedupKey.
  scopeKey: string;
}

function latestAttempt(stageRuns: readonly StageRunView[], stage: StageRunView["stage"]): StageRunView | undefined {
  return stageRuns
    .filter((r) => r.stage === stage)
    .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
}

// One pure predicate per spec-section-21 rule. Each returns null when the
// rule doesn't fire — alert-evaluation.service.ts calls every rule after
// each ingest() pass and only persists the non-null candidates.

export function ingestionFailed(stageRuns: readonly StageRunView[], executionId: string): AlertCandidate | null {
  const run = latestAttempt(stageRuns, "BRONZE_INGESTION");
  if (run?.status !== "FAILED") return null;
  return {
    alertType: "INGESTION_FAILED",
    severity: "CRITICAL",
    title: "Bronze ingestion failed",
    description: `Bronze ingestion failed for execution ${executionId}.`,
    scopeKey: executionId,
  };
}

export function pipelineFailed(stageRuns: readonly StageRunView[], executionId: string): AlertCandidate | null {
  const failedPipelineStage = (["SILVER_TRANSFORMATION", "GOLD_PRODUCT_BUILD"] as const)
    .map((stage) => latestAttempt(stageRuns, stage))
    .find((run) => run?.status === "FAILED");
  if (!failedPipelineStage) return null;
  return {
    alertType: "PIPELINE_FAILED",
    severity: "CRITICAL",
    title: `${failedPipelineStage.stage} pipeline failed`,
    description: `${failedPipelineStage.stage} failed for execution ${executionId}.`,
    scopeKey: executionId,
  };
}

export function pipelineStuck(
  input: { stage: StageRunView["stage"]; stuck: boolean; elapsedMinutes: number | null },
  executionId: string,
): AlertCandidate | null {
  if (!input.stuck) return null;
  return {
    alertType: "PIPELINE_STUCK",
    severity: "WARNING",
    title: `${input.stage} appears stuck`,
    description: `${input.stage} has been RUNNING for ${Math.round(input.elapsedMinutes ?? 0)} minutes on execution ${executionId}.`,
    scopeKey: executionId,
  };
}

export function qualityThresholdBreached(stageRuns: readonly StageRunView[], executionId: string): AlertCandidate | null {
  const run = latestAttempt(stageRuns, "QUALITY_VALIDATION");
  if (run?.status !== "FAILED") return null;
  return {
    alertType: "QUALITY_THRESHOLD_BREACHED",
    severity: "CRITICAL",
    title: "Quality threshold breached",
    description: `Quality validation failed for execution ${executionId}.`,
    scopeKey: executionId,
  };
}

export function publicationFailed(stageRuns: readonly StageRunView[], executionId: string): AlertCandidate | null {
  const run = latestAttempt(stageRuns, "PUBLICATION");
  if (run?.status !== "FAILED") return null;
  return {
    alertType: "PUBLICATION_FAILED",
    severity: "CRITICAL",
    title: "Publication failed",
    description: `Publication failed for execution ${executionId}.`,
    scopeKey: executionId,
  };
}

export function deliveryLate(stageRuns: readonly StageRunView[], executionId: string): AlertCandidate | null {
  const lateStage = (["OUTBOUND_EXCHANGE", "FILE_DELIVERY", "API_DELIVERY"] as const)
    .map((stage) => latestAttempt(stageRuns, stage))
    .find((run) => run?.status === "LATE");
  if (!lateStage) return null;
  return {
    alertType: "DELIVERY_LATE",
    severity: "WARNING",
    title: `${lateStage.stage} is late`,
    description: `${lateStage.stage} has not completed within its expected window for execution ${executionId}.`,
    scopeKey: executionId,
  };
}

export function businessSlaBreached(businessSlaStatus: SlaStatus, executionId: string, breachDurationSeconds: number | null): AlertCandidate | null {
  if (businessSlaStatus !== "FAIL") return null;
  const minutes = breachDurationSeconds !== null ? Math.round(breachDurationSeconds / 60) : null;
  return {
    alertType: "BUSINESS_SLA_BREACHED",
    severity: "CRITICAL",
    title: "Business SLA breached",
    description: `Execution ${executionId} missed its customer delivery deadline${minutes !== null ? ` by ${minutes} minutes` : ""}.`,
    scopeKey: executionId,
  };
}

export function freshnessSlaBreached(technicalSlaStatus: SlaStatus, executionId: string): AlertCandidate | null {
  if (technicalSlaStatus !== "FAIL") return null;
  return {
    alertType: "FRESHNESS_SLA_BREACHED",
    severity: "WARNING",
    title: "Freshness SLA breached",
    description: `Technical SLA (freshness/stage targets) failed for execution ${executionId}.`,
    scopeKey: executionId,
  };
}

export function repeatedRetries(retryCount: number, executionId: string, threshold = 3): AlertCandidate | null {
  if (retryCount < threshold) return null;
  return {
    alertType: "REPEATED_RETRIES",
    severity: "WARNING",
    title: "Repeated retries observed",
    description: `Execution ${executionId} has retried ${retryCount} times.`,
    scopeKey: executionId,
  };
}

// Aggregate rules (not execution-scoped): API availability and no-data
// windows are evaluated per (tenant, product, version, window) rather than
// per execution — the caller supplies a window bucket string for the
// dedup scopeKey.
export function apiAvailabilityBelowThreshold(
  successRatePercent: number,
  thresholdPercent: number,
  windowBucket: string,
): AlertCandidate | null {
  if (successRatePercent >= thresholdPercent) return null;
  return {
    alertType: "API_AVAILABILITY_BELOW_THRESHOLD",
    severity: "CRITICAL",
    title: "API availability below threshold",
    description: `API success rate ${successRatePercent.toFixed(2)}% fell below the ${thresholdPercent}% threshold.`,
    scopeKey: windowBucket,
  };
}

export function noDataReceived(minutesSinceLastEvent: number, windowMinutes: number, windowBucket: string): AlertCandidate | null {
  if (minutesSinceLastEvent < windowMinutes) return null;
  return {
    alertType: "NO_DATA_RECEIVED",
    severity: "WARNING",
    title: "No data received within expected window",
    description: `No operational event received for ${Math.round(minutesSinceLastEvent)} minutes (expected within ${windowMinutes}).`,
    scopeKey: windowBucket,
  };
}
