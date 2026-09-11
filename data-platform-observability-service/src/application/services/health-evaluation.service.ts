import type pg from "pg";
import { computeHealth, type HealthComponentScores, type HealthResult } from "../../domain/health/health-score.js";
import { healthWeights } from "../../config/env.js";
import type { SlaStatus } from "../../config/constants.js";
import { findExecutionById, updateExecutionRollup } from "../../infrastructure/persistence/execution.repository.js";
import { listStageRunsForExecution } from "../../infrastructure/persistence/stage-run.repository.js";

function slaComponentScore(status: SlaStatus): number {
  switch (status) {
    case "PASS":
    case "NOT_APPLICABLE":
      return 100;
    case "AT_RISK":
      return 70;
    case "UNKNOWN":
      return 85;
    case "FAIL":
      return 0;
  }
}

function stageComponentScore(status: string | undefined, inProgressScore: number): number {
  if (status === "SUCCEEDED") return 100;
  if (status === "FAILED") return 0;
  if (status === undefined) return inProgressScore;
  return inProgressScore;
}

// Pure(ish) computation, read-only — reusable by both the persisting
// evaluator below and the health API route (which needs the full
// transparent component breakdown, spec section 17, without re-persisting
// anything on a simple GET).
export async function computeHealthForExecution(client: pg.Pool | pg.PoolClient, executionId: string): Promise<HealthResult | null> {
  const execution = await findExecutionById(client, executionId);
  if (!execution) return null;

  const stageRuns = await listStageRunsForExecution(client, executionId);
  const latestByStage = new Map(stageRuns.map((r) => [r.stage, r]));

  const qualityRun = latestByStage.get("QUALITY_VALIDATION");
  const publicationRun = latestByStage.get("PUBLICATION");
  const deliveryRun = latestByStage.get("OUTBOUND_EXCHANGE") ?? latestByStage.get("FILE_DELIVERY") ?? latestByStage.get("API_DELIVERY");

  const failedOrRetryingCount = stageRuns.filter((r) => r.status === "FAILED" || r.status === "RETRYING" || r.attemptNumber > 1).length;

  const componentScores: HealthComponentScores = {
    sla: Math.min(slaComponentScore(execution.technicalSlaStatus), slaComponentScore(execution.businessSlaStatus)),
    freshness: slaComponentScore(execution.technicalSlaStatus),
    quality: stageComponentScore(qualityRun?.status, 90),
    availability: stageComponentScore(deliveryRun?.status, 80),
    publicationSuccess: stageComponentScore(publicationRun?.status, 85),
    retryFailure: failedOrRetryingCount === 0 ? 100 : Math.max(0, 100 - failedOrRetryingCount * 30),
  };

  return computeHealth(componentScores, healthWeights);
}

// Computes then rolls the result up onto operational_executions.health_status
// — run immediately after SLA evaluation in the ingestion pipeline, since
// health depends on SLA status.
export async function evaluateHealthForExecution(client: pg.Pool | pg.PoolClient, executionId: string): Promise<HealthResult | null> {
  const result = await computeHealthForExecution(client, executionId);
  if (!result) return null;
  await updateExecutionRollup(client, executionId, { healthStatus: result.status });
  return result;
}
