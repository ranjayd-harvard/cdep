import { CronExpressionParser } from "cron-parser";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import type { ScheduleConfig, ScheduleStrategy } from "../schedule.js";

// AGENTS.md section 20-21: a mature, actively maintained cron library
// (cron-parser), 5-field format only (minute hour day-of-month month
// day-of-week — no seconds field, no `@daily`-style named shortcuts),
// evaluated in the subscription's configured timezone. The 5-field format
// structurally cannot express sub-minute schedules (minute is the finest
// unit), which is what enforces the 1-minute floor — the min-interval
// check below is defense in depth on top of that, not the primary
// mechanism.
export function validateCronExpression(expression: string, minIntervalSeconds = env.SCHEDULER_CRON_MIN_INTERVAL_SECONDS): void {
  const fieldCount = expression.trim().split(/\s+/).length;
  if (fieldCount !== 5) {
    throw new AppError(
      "INVALID_SCHEDULE_CONFIG",
      `Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week). ` +
        `Seconds fields and named shortcuts (e.g. '@daily') are not supported. Got: '${expression}'.`,
    );
  }

  let parsed;
  try {
    // strict:true is deliberately omitted -- cron-parser v5 interprets it as
    // "require the full 6-field (seconds-included) syntax", which is
    // exactly what section 20's 5-field-only policy rejects. The explicit
    // field-count check above is what actually enforces that policy.
    parsed = CronExpressionParser.parse(expression, { tz: "UTC" });
  } catch (err) {
    throw new AppError("INVALID_SCHEDULE_CONFIG", `Invalid cron expression '${expression}': ${(err as Error).message}`);
  }

  const first = parsed.next().toDate();
  const second = parsed.next().toDate();
  const gapSeconds = (second.getTime() - first.getTime()) / 1000;
  if (gapSeconds < minIntervalSeconds) {
    throw new AppError(
      "INVALID_SCHEDULE_CONFIG",
      `Cron expression '${expression}' produces occurrences ${gapSeconds}s apart, below the configured minimum of ${minIntervalSeconds}s.`,
    );
  }
}

export const CronScheduleStrategy: ScheduleStrategy = {
  mode: "CRON",
  calculateNextRun(config: ScheduleConfig, after: Date): Date {
    if (!config.cronExpression) {
      throw new AppError("INVALID_SCHEDULE_CONFIG", "CRON schedules require cron_expression.");
    }
    validateCronExpression(config.cronExpression);

    const timezone = config.timezone ?? "UTC";
    let parsed;
    try {
      parsed = CronExpressionParser.parse(config.cronExpression, { currentDate: after, tz: timezone });
    } catch (err) {
      throw new AppError("INVALID_SCHEDULE_CONFIG", `Invalid cron expression '${config.cronExpression}': ${(err as Error).message}`);
    }
    return parsed.next().toDate();
  },
};
