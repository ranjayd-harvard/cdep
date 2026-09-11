import type { OperationalStage, OperationalStatus } from "../config/constants.js";

export interface StageRunTimelineInput {
  stage: OperationalStage;
  status: OperationalStatus;
  sourceService: string;
  sourceEntityId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface TimelineEntry {
  timestamp: Date;
  stage: OperationalStage;
  status: OperationalStatus;
  sourceService: string;
  sourceEntityId: string | null;
  durationMs: number | null;
  message: string;
}

// Operationally-safe message only (spec section 25) — stage/status/source,
// never a raw error payload or any customer-data-bearing detail.
function messageFor(run: StageRunTimelineInput, phase: "started" | "completed"): string {
  if (phase === "started") {
    return `${run.stage} started (${run.sourceService})`;
  }
  if (run.status === "FAILED") {
    return `${run.stage} failed${run.errorMessage ? `: ${run.errorMessage}` : ""}`;
  }
  return `${run.stage} ${run.status.toLowerCase()}`;
}

// Builds the ordered per-execution timeline (spec section 25) from stage
// run data only — never reads a sibling's raw internal record.
export function buildTimeline(stageRuns: readonly StageRunTimelineInput[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const run of stageRuns) {
    if (run.startedAt) {
      entries.push({
        timestamp: run.startedAt,
        stage: run.stage,
        status: "RUNNING",
        sourceService: run.sourceService,
        sourceEntityId: run.sourceEntityId,
        durationMs: null,
        message: messageFor(run, "started"),
      });
    }
    if (run.completedAt) {
      entries.push({
        timestamp: run.completedAt,
        stage: run.stage,
        status: run.status,
        sourceService: run.sourceService,
        sourceEntityId: run.sourceEntityId,
        durationMs: run.durationMs,
        message: messageFor(run, "completed"),
      });
    }
  }

  return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
