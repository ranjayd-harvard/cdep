import { AppError } from "../../common/errors/app-error.js";
import { calendarDateInZone, parseDeliveryTimeLocal, zonedWallTimeToUtc } from "../timezone.js";
import type { ScheduleConfig, ScheduleStrategy } from "../schedule.js";

function addCalendarDays(ymd: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  // Calendar-date arithmetic only (never an instant) — safe to do in UTC
  // regardless of the target zone, since we only care about the Y/M/D
  // triple, not any particular moment in time.
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// AGENTS.md section 18: calendar-based occurrence, never `lastRun + 24h`
// (that breaks across DST for a local wall-clock schedule).
export const DailyScheduleStrategy: ScheduleStrategy = {
  mode: "DAILY",
  calculateNextRun(config: ScheduleConfig, after: Date): Date {
    if (!config.deliveryTimeLocal) {
      throw new AppError("INVALID_SCHEDULE_CONFIG", "DAILY schedules require delivery_time.");
    }
    const timezone = config.timezone ?? "UTC";
    const time = parseDeliveryTimeLocal(config.deliveryTimeLocal);

    let ymd = calendarDateInZone(after, timezone);
    let candidate = zonedWallTimeToUtc({ ...ymd, ...time }, timezone);
    if (candidate.getTime() <= after.getTime()) {
      ymd = addCalendarDays(ymd, 1);
      candidate = zonedWallTimeToUtc({ ...ymd, ...time }, timezone);
    }
    return candidate;
  },
};
