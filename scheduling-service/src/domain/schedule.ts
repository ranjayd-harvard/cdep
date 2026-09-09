import type { DayOfWeek, ScheduleMode } from "../config/constants.js";

// Mirrors what subscription-service's DeliveryPreference/DeliveryContextDTO
// already carries (frequency/deliveryTime/timezone) — the Scheduler
// projects that into this shape rather than inventing new field names
// (AGENTS.md section 9).
export interface ScheduleConfig {
  mode: ScheduleMode;
  timezone: string | null;
  deliveryTimeLocal: string | null; // "HH:MM" or "HH:MM:SS"
  dayOfWeek: DayOfWeek | null;
  cronExpression: string | null;
}

// Strategy contract (AGENTS.md section 8): every schedule mode implements
// this and nothing else. Adding EVENT_DRIVEN/DATA_READY/THRESHOLD/
// SLA_TRIGGERED later means adding a new implementation, not touching
// DueScheduleScanner.
export interface ScheduleStrategy {
  readonly mode: ScheduleMode;
  // Next occurrence strictly after `after`, in the strategy's own
  // resolved-to-UTC terms. Returns null for modes with no automatic
  // schedule (ON_DEMAND).
  calculateNextRun(config: ScheduleConfig, after: Date): Date | null;
}
