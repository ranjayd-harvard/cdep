import { AppError } from "../../common/errors/app-error.js";
import type { VersionLifecycleStatus } from "../../config/constants.js";

// Phase 10 §16 — centralized state machine, mirroring
// subscription-service/src/domain/transition-rules.ts's canTransition/
// assertTransition shape exactly. Every lifecycle command routes through
// assertTransition() rather than validating inline.
//
// DEPRECATED -> ACTIVE is listed here because it IS a valid transition in
// principle, but it is reachable only through the dedicated rollback()
// action (spec §17/§33), never through the generic activate() action —
// activateVersion() enforces that narrower rule itself (it only ever calls
// assertTransition from DRAFT or BETA), not this table.
const ALLOWED_TRANSITIONS: Record<VersionLifecycleStatus, readonly VersionLifecycleStatus[]> = {
  DRAFT: ["BETA", "ACTIVE"],
  BETA: ["ACTIVE", "RETIRED"],
  ACTIVE: ["DEPRECATED"],
  DEPRECATED: ["RETIRED", "ACTIVE"],
  RETIRED: [],
};

export function canTransition(from: VersionLifecycleStatus, to: VersionLifecycleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: VersionLifecycleStatus, to: VersionLifecycleStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError("INVALID_VERSION_TRANSITION", `Cannot transition version from ${from} to ${to}.`);
  }
}
