import type { ScheduleConfig, ScheduleStrategy } from "../schedule.js";

// ON_DEMAND means the scheduler never creates automatic due executions
// (AGENTS.md section 22) — DueScheduleScanner simply never claims a
// projection in this mode because next_run_at is never set for it.
export const OnDemandScheduleStrategy: ScheduleStrategy = {
  mode: "ON_DEMAND",
  calculateNextRun(_config: ScheduleConfig, _after: Date): Date | null {
    return null;
  },
};
