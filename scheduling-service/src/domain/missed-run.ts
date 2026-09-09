import type { MissedRunPolicy } from "../config/constants.js";
import type { ScheduleConfig, ScheduleStrategy } from "./schedule.js";

export interface MissedRunResolution {
  action: "RUN" | "SKIP";
  occurrenceToRun: Date | null;
}

// AGENTS.md section 36-37: default policy is RUN_LATEST with a
// configurable grace window — a schedule that becomes due while the
// scheduler is briefly offline still runs once caught up; one that's been
// offline far longer than the grace window does not automatically replay
// a stale occurrence. RUN_ALL is a documented but unimplemented extension
// point (never enabled by default) — treated as RUN_LATEST here rather
// than silently flooding downstream services.
export function resolveMissedRun(latestMissedOccurrence: Date, now: Date, policy: MissedRunPolicy, graceMinutes: number): MissedRunResolution {
  if (policy === "SKIP") {
    return { action: "SKIP", occurrenceToRun: null };
  }
  const ageMinutes = (now.getTime() - latestMissedOccurrence.getTime()) / 60_000;
  if (ageMinutes <= graceMinutes) {
    return { action: "RUN", occurrenceToRun: latestMissedOccurrence };
  }
  return { action: "SKIP", occurrenceToRun: null };
}

// Walks a strategy forward from `from` (inclusive) to find the latest
// occurrence at or before `now` — the "one or more schedules were missed
// while the scheduler was offline" case (AGENTS.md section 36). Bounded so
// a misconfigured high-frequency schedule can never spin unboundedly.
export function findLatestDueOccurrence(
  strategy: ScheduleStrategy,
  config: ScheduleConfig,
  from: Date,
  now: Date,
  maxIterations = 100_000,
): Date | null {
  let latest: Date | null = from.getTime() <= now.getTime() ? from : null;
  let cursor = from;
  for (let i = 0; i < maxIterations; i++) {
    const next = strategy.calculateNextRun(config, cursor);
    if (!next || next.getTime() > now.getTime()) break;
    latest = next;
    cursor = next;
  }
  return latest;
}
