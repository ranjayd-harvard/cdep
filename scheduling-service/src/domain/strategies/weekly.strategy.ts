import { AppError } from "../../common/errors/app-error.js";
import { calendarDateInZone, dayOfWeekInZone, parseDeliveryTimeLocal, zonedWallTimeToUtc } from "../timezone.js";
import type { ScheduleConfig, ScheduleStrategy } from "../schedule.js";

function addCalendarDays(ymd: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// AGENTS.md section 19: day-of-week is an explicit enum, evaluated in the
// subscription's configured zone (a Friday-night-close-to-midnight
// schedule must land on the customer's actual local Friday, not UTC's).
export const WeeklyScheduleStrategy: ScheduleStrategy = {
  mode: "WEEKLY",
  calculateNextRun(config: ScheduleConfig, after: Date): Date {
    if (!config.deliveryTimeLocal) {
      throw new AppError("INVALID_SCHEDULE_CONFIG", "WEEKLY schedules require delivery_time.");
    }
    if (!config.dayOfWeek) {
      throw new AppError("INVALID_SCHEDULE_CONFIG", "WEEKLY schedules require day_of_week.");
    }
    const timezone = config.timezone ?? "UTC";
    const time = parseDeliveryTimeLocal(config.deliveryTimeLocal);

    let ymd = calendarDateInZone(after, timezone);
    // At most 8 iterations: worst case is "today matches but time already
    // passed", requiring a full 7-day walk back to the same weekday.
    for (let i = 0; i < 8; i++) {
      const candidate = zonedWallTimeToUtc({ ...ymd, ...time }, timezone);
      const weekday = dayOfWeekInZone(candidate, timezone);
      if (weekday === config.dayOfWeek && candidate.getTime() > after.getTime()) {
        return candidate;
      }
      ymd = addCalendarDays(ymd, 1);
    }
    throw new AppError("INTERNAL_ERROR", `Could not resolve next WEEKLY occurrence for day_of_week=${config.dayOfWeek}.`);
  },
};
