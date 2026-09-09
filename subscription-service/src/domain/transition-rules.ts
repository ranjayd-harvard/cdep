import { AppError } from "../common/errors/app-error.js";
import type { SubscriptionStatus } from "../config/constants.js";

// Centralized state machine (spec §17) — every lifecycle command routes
// through assertTransition() rather than validating inline, so the matrix
// below is the single place transition rules can ever change.
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  PENDING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "SUSPENDED", "CANCELLED"],
  PAUSED: ["ACTIVE", "SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// CANCELLED is terminal (spec §16/§74 invariant #19) — enforced here, not
// re-checked ad hoc at each call site.
export function assertTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError("INVALID_STATE_TRANSITION", `Cannot transition subscription from ${from} to ${to}.`);
  }
}
