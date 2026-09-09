import type { FailureCategory } from "../config/constants.js";

export interface BackoffConfig {
  initialBackoffSeconds: number;
  maxBackoffSeconds: number;
  multiplier: number;
  jitterRatio: number;
}

// Configurable exponential backoff with jitter (AGENTS.md section 39).
// `attempt` is 1-based: the delay before the Nth retry attempt. Jitter is
// applied as +/- jitterRatio of the capped value so concurrent executions
// hitting the same downstream outage don't all retry in lockstep.
export function calculateBackoffSeconds(attempt: number, config: BackoffConfig, random: () => number = Math.random): number {
  const raw = config.initialBackoffSeconds * Math.pow(config.multiplier, Math.max(attempt - 1, 0));
  const capped = Math.min(raw, config.maxBackoffSeconds);
  const jitter = capped * config.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

// AGENTS.md section 38/63: policy denials and permanent configuration
// problems never retry indefinitely; only genuinely transient conditions
// do.
const RETRIABLE_CATEGORIES: ReadonlySet<FailureCategory> = new Set([
  "TRANSIENT_DEPENDENCY_FAILURE",
  "DATABASE_FAILURE",
  "INTERNAL_FAILURE",
  "PUBLICATION_TIMEOUT",
]);

export function isRetriableFailure(category: FailureCategory): boolean {
  return RETRIABLE_CATEGORIES.has(category);
}
