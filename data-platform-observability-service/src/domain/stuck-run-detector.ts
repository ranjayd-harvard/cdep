import type { OperationalStage, OperationalStatus } from "../config/constants.js";

export interface StuckCheckInput {
  stage: OperationalStage;
  status: OperationalStatus;
  startedAt: Date | null;
}

export interface StuckRunResult {
  stuck: boolean;
  elapsedMinutes: number | null;
  thresholdMinutes: number;
}

// Detects a run stuck in RUNNING beyond a configurable per-stage/product/
// version threshold (spec section 19). Thresholds are resolved by the
// caller (defaultStageTargetMinutes() or a STAGE_TARGET sla_definitions
// override) and passed in — this function only compares elapsed time.
export function detectStuckRun(run: StuckCheckInput, now: Date, thresholdMinutes: number): StuckRunResult {
  if (run.status !== "RUNNING" || !run.startedAt) {
    return { stuck: false, elapsedMinutes: null, thresholdMinutes };
  }
  const elapsedMinutes = (now.getTime() - run.startedAt.getTime()) / 60_000;
  return { stuck: elapsedMinutes > thresholdMinutes, elapsedMinutes, thresholdMinutes };
}
