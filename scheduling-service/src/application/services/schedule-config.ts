import type { DayOfWeek, ScheduleMode } from "../../config/constants.js";
import { DAYS_OF_WEEK } from "../../config/constants.js";
import type { ScheduleConfig } from "../../domain/schedule.js";
import type { DeliveryConfig } from "../../ports/subscription-client.port.js";

// MONTHLY intentionally maps to null — subscription-service's `frequency`
// enum predates Phase 7 and still accepts it, but no MonthlyScheduleStrategy
// exists yet (AGENTS.md section 8: future modes must not require rewriting
// the scanner). A subscription on an unmapped frequency simply never gets
// an automatic next_run_at; manual/on-demand triggers still work.
const FREQUENCY_TO_MODE: Partial<Record<string, ScheduleMode>> = {
  ON_DEMAND: "ON_DEMAND",
  DAILY: "DAILY",
  WEEKLY: "WEEKLY",
  CRON: "CRON",
};

export function scheduleModeForFrequency(frequency: string): ScheduleMode | null {
  return FREQUENCY_TO_MODE[frequency] ?? null;
}

export function isDayOfWeek(value: string | null): value is DayOfWeek {
  return value !== null && (DAYS_OF_WEEK as readonly string[]).includes(value);
}

export function buildScheduleConfig(mode: ScheduleMode, delivery: DeliveryConfig): ScheduleConfig {
  return {
    mode,
    timezone: delivery.timezone,
    deliveryTimeLocal: delivery.deliveryTime,
    dayOfWeek: isDayOfWeek(delivery.dayOfWeek) ? delivery.dayOfWeek : null,
    cronExpression: delivery.cronExpression,
  };
}
