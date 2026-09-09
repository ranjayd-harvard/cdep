import type { ExecutionReason } from "../config/constants.js";

// Deterministic idempotency identity (AGENTS.md section 12):
// subscriptionId + scheduledFor + reason. A unique Postgres constraint on
// this value is what makes scheduler restarts, overlapping leadership,
// duplicate due-scans, and process retries all converge on exactly one
// logical execution per occurrence.
export function buildScheduledExecutionKey(subscriptionId: string, scheduledFor: Date, reason: Extract<ExecutionReason, "SCHEDULED" | "MISSED_RUN_RECOVERY">): string {
  return `${subscriptionId}|${scheduledFor.toISOString()}|${reason}`;
}

// Manual/on-demand triggers use a client-safe request/idempotency key
// instead of a calendar occurrence (AGENTS.md section 12/23) — when the
// caller supplies one, it IS the sole duplicate-submission guard; when they
// don't, a fresh key is generated per call (equivalent to subscription-
// service's own withIdempotency: a missing key means "no dedup requested",
// not "dedup against nothing").
export function buildManualExecutionKey(subscriptionId: string, reason: Extract<ExecutionReason, "MANUAL" | "ON_DEMAND">, idempotencyKey: string): string {
  return `${subscriptionId}|${reason}|${idempotencyKey}`;
}
