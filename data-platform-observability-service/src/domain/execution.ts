import type { OperationalStage, OperationalStatus } from "../config/constants.js";
import { stageIndex } from "./stage.js";

export interface StageRunView {
  stage: OperationalStage;
  status: OperationalStatus;
  attemptNumber: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ExecutionDerivedState {
  currentStage: OperationalStage | null;
  overallStatus: OperationalStatus;
  startedAt: Date | null;
  completedAt: Date | null;
}

// A pipeline can legitimately terminate at any of these depending on the
// product's configured delivery method(s) — success does not require every
// one of the 10 normalized stages to have run (spec section 18: never
// falsely mark a stage that never executed).
const DELIVERY_TERMINAL_STAGES: readonly OperationalStage[] = ["OUTBOUND_EXCHANGE", "FILE_DELIVERY", "API_DELIVERY"];

function latestAttemptPerStage(stageRuns: readonly StageRunView[]): StageRunView[] {
  const byStage = new Map<OperationalStage, StageRunView>();
  for (const run of stageRuns) {
    const existing = byStage.get(run.stage);
    if (!existing || run.attemptNumber >= existing.attemptNumber) {
      byStage.set(run.stage, run);
    }
  }
  return [...byStage.values()];
}

function earliestStartedAt(runs: readonly StageRunView[]): Date | null {
  const dates = runs.map((r) => r.startedAt).filter((d): d is Date => d !== null);
  if (dates.length === 0) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
}

// Pure re-derivation of an execution's rollup fields from its full set of
// stage runs (spec section 6 "update execution" verb). Never reads a
// sibling's own workflow state directly — only what's already been
// normalized into operational_stage_runs.
export function deriveExecutionState(stageRuns: readonly StageRunView[]): ExecutionDerivedState {
  const current = latestAttemptPerStage(stageRuns);
  if (current.length === 0) {
    return { currentStage: null, overallStatus: "PENDING", startedAt: null, completedAt: null };
  }

  const startedAt = earliestStartedAt(current);

  const failed = current.filter((r) => r.status === "FAILED").sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage));
  if (failed.length > 0) {
    const rootFailure = failed[0]!;
    return { currentStage: rootFailure.stage, overallStatus: "FAILED", startedAt, completedAt: rootFailure.completedAt };
  }

  const cancelled = current.filter((r) => r.status === "CANCELLED").sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage));
  if (cancelled.length > 0) {
    const first = cancelled[0]!;
    return { currentStage: first.stage, overallStatus: "CANCELLED", startedAt, completedAt: first.completedAt };
  }

  const retrying = current.find((r) => r.status === "RETRYING");
  if (retrying) {
    return { currentStage: retrying.stage, overallStatus: "RETRYING", startedAt, completedAt: null };
  }

  const last = [...current].sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage))[0]!;

  if (last.status === "SUCCEEDED" && DELIVERY_TERMINAL_STAGES.includes(last.stage)) {
    return { currentStage: last.stage, overallStatus: "SUCCEEDED", startedAt, completedAt: last.completedAt };
  }

  if (last.status === "SUCCEEDED") {
    // A non-terminal stage succeeded and nothing further has been observed
    // yet — the execution is still in flight, waiting on the next stage.
    return { currentStage: last.stage, overallStatus: "RUNNING", startedAt, completedAt: null };
  }

  if (last.status === "PENDING" || last.status === "UNKNOWN") {
    return { currentStage: last.stage, overallStatus: "PENDING", startedAt, completedAt: null };
  }

  // RUNNING, BLOCKED, LATE map straight through to the same execution-level status.
  return { currentStage: last.stage, overallStatus: last.status, startedAt, completedAt: null };
}
