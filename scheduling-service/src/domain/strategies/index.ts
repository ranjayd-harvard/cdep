import type { ScheduleMode } from "../../config/constants.js";
import type { ScheduleStrategy } from "../schedule.js";
import { OnDemandScheduleStrategy } from "./on-demand.strategy.js";
import { DailyScheduleStrategy } from "./daily.strategy.js";
import { WeeklyScheduleStrategy } from "./weekly.strategy.js";
import { CronScheduleStrategy } from "./cron.strategy.js";

const STRATEGIES: Record<ScheduleMode, ScheduleStrategy> = {
  ON_DEMAND: OnDemandScheduleStrategy,
  DAILY: DailyScheduleStrategy,
  WEEKLY: WeeklyScheduleStrategy,
  CRON: CronScheduleStrategy,
};

export function getScheduleStrategy(mode: ScheduleMode): ScheduleStrategy {
  return STRATEGIES[mode];
}

export { OnDemandScheduleStrategy, DailyScheduleStrategy, WeeklyScheduleStrategy, CronScheduleStrategy };
export { validateCronExpression } from "./cron.strategy.js";
