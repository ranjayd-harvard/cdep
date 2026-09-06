import { AppError } from "../../common/errors/app-error.js";
import {
  ALLOWED_FROM_ANY,
  INBOUND_TRANSITIONS,
  OUTBOUND_TRANSITIONS,
  type ExchangeDirection,
  type ExchangeStatus,
} from "../../config/constants.js";

// Enforces allowed state transitions — AGENTS.md section 17 forbids
// arbitrary status changes. Throws INVALID_STATE_TRANSITION rather than
// silently applying an illegal move.
export function assertValidTransition(
  direction: ExchangeDirection,
  from: ExchangeStatus,
  to: ExchangeStatus,
): void {
  if ((ALLOWED_FROM_ANY as readonly string[]).includes(to)) return;

  const table = direction === "INBOUND" ? INBOUND_TRANSITIONS : OUTBOUND_TRANSITIONS;
  const allowed = table[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      `Cannot transition ${direction} exchange from ${from} to ${to}.`,
    );
  }
}
