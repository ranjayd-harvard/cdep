import { OPERATIONAL_STAGES, type OperationalStage, type OperationalStatus } from "../config/constants.js";

// Canonical pipeline ordering (spec section 4/18) — the sequence a healthy
// execution's stages complete in. Used by failed-stage-detector to decide
// whether a stage that has no run yet is merely PENDING (nothing upstream
// has failed) or BLOCKED (something upstream did).
export const STAGE_ORDER: readonly OperationalStage[] = OPERATIONAL_STAGES;

export function stageIndex(stage: OperationalStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function isBeforeOrSame(a: OperationalStage, b: OperationalStage): boolean {
  return stageIndex(a) <= stageIndex(b);
}

const ACTIVE_STATUSES: readonly OperationalStatus[] = ["PENDING", "RUNNING", "RETRYING", "BLOCKED", "LATE", "UNKNOWN"];

export function isActiveStatus(status: OperationalStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
