import type { OperationalStage } from "../config/constants.js";
import type { StageRunView } from "./execution.js";
import { STAGE_ORDER, stageIndex } from "./stage.js";

export interface FailedStageResult {
  failedStage: OperationalStage | null;
  downstreamBlocked: boolean;
  // Stages after failedStage in STAGE_ORDER that have no recorded run at
  // all — reported explicitly so callers never confuse "never executed"
  // with "failed" (spec section 18).
  neverStartedStages: OperationalStage[];
}

function latestAttemptPerStage(stageRuns: readonly StageRunView[]): Map<OperationalStage, StageRunView> {
  const byStage = new Map<OperationalStage, StageRunView>();
  for (const run of stageRuns) {
    const existing = byStage.get(run.stage);
    if (!existing || run.attemptNumber >= existing.attemptNumber) {
      byStage.set(run.stage, run);
    }
  }
  return byStage;
}

// Identifies which stage is actually responsible for an execution's failure
// (spec section 18) — the root cause is the earliest-in-pipeline-order
// FAILED stage, never a downstream stage that simply hasn't run yet.
export function detectFailedStage(stageRuns: readonly StageRunView[]): FailedStageResult {
  const byStage = latestAttemptPerStage(stageRuns);

  const failedStages = [...byStage.values()]
    .filter((r) => r.status === "FAILED")
    .sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage));

  if (failedStages.length === 0) {
    return { failedStage: null, downstreamBlocked: false, neverStartedStages: [] };
  }

  const rootFailure = failedStages[0]!;
  const neverStartedStages = STAGE_ORDER.filter(
    (stage) => stageIndex(stage) > stageIndex(rootFailure.stage) && !byStage.has(stage),
  );

  return {
    failedStage: rootFailure.stage,
    downstreamBlocked: stageIndex(rootFailure.stage) < STAGE_ORDER.length - 1,
    neverStartedStages,
  };
}
