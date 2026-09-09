import { describe, expect, it } from "vitest";
import { DailyScheduleStrategy } from "../../domain/strategies/daily.strategy.js";
import { WeeklyScheduleStrategy } from "../../domain/strategies/weekly.strategy.js";
import { CronScheduleStrategy, validateCronExpression } from "../../domain/strategies/cron.strategy.js";
import { OnDemandScheduleStrategy } from "../../domain/strategies/on-demand.strategy.js";
import type { ScheduleConfig } from "../../domain/schedule.js";

// DAILY/WEEKLY/CRON always return a concrete Date (or throw) — only
// ON_DEMAND legitimately returns null. Narrows the shared ScheduleStrategy
// interface's `Date | null` return for these known-non-null test cases.
function must(date: Date | null): Date {
  if (!date) throw new Error("Expected a resolved Date, got null.");
  return date;
}

const utcConfig = (overrides: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  mode: "DAILY",
  timezone: "UTC",
  deliveryTimeLocal: "06:00",
  dayOfWeek: null,
  cronExpression: null,
  ...overrides,
});

describe("OnDemandScheduleStrategy", () => {
  it("never produces an automatic next run", () => {
    expect(OnDemandScheduleStrategy.calculateNextRun(utcConfig({ mode: "ON_DEMAND" }), new Date())).toBeNull();
  });
});

describe("DailyScheduleStrategy", () => {
  it("returns today's occurrence when it is still ahead", () => {
    const after = new Date("2026-09-08T00:00:00.000Z");
    const next = must(DailyScheduleStrategy.calculateNextRun(utcConfig(), after));
    expect(next.toISOString()).toBe("2026-09-08T06:00:00.000Z");
  });

  it("rolls over to tomorrow once today's occurrence has passed", () => {
    const after = new Date("2026-09-08T06:00:00.000Z");
    const next = must(DailyScheduleStrategy.calculateNextRun(utcConfig(), after));
    expect(next.toISOString()).toBe("2026-09-09T06:00:00.000Z");
  });

  it("is never computed as lastRun + 24h across a DST transition (America/New_York)", () => {
    // 2026-03-07 06:00 EST is 11:00 UTC; 2026-03-08 06:00 EDT (after
    // spring-forward) is 10:00 UTC -- only a 23-hour gap, not 24.
    const config = utcConfig({ timezone: "America/New_York" });
    const first = must(DailyScheduleStrategy.calculateNextRun(config, new Date("2026-03-07T00:00:00.000Z")));
    const second = must(DailyScheduleStrategy.calculateNextRun(config, first));
    expect(first.toISOString()).toBe("2026-03-07T11:00:00.000Z");
    expect(second.toISOString()).toBe("2026-03-08T10:00:00.000Z");
    expect(second.getTime() - first.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("throws for a missing delivery_time", () => {
    expect(() => DailyScheduleStrategy.calculateNextRun(utcConfig({ deliveryTimeLocal: null }), new Date())).toThrow();
  });
});

describe("WeeklyScheduleStrategy", () => {
  it("returns the next occurrence of the target weekday", () => {
    // 2026-09-08 is a Tuesday; next FRIDAY 06:00 UTC is 2026-09-11.
    const config = utcConfig({ mode: "WEEKLY", dayOfWeek: "FRIDAY" });
    const next = must(WeeklyScheduleStrategy.calculateNextRun(config, new Date("2026-09-08T00:00:00.000Z")));
    expect(next.toISOString()).toBe("2026-09-11T06:00:00.000Z");
  });

  it("rolls over a full week when today is the target day but the time has passed", () => {
    const config = utcConfig({ mode: "WEEKLY", dayOfWeek: "TUESDAY" });
    const next = must(WeeklyScheduleStrategy.calculateNextRun(config, new Date("2026-09-08T12:00:00.000Z")));
    expect(next.toISOString()).toBe("2026-09-15T06:00:00.000Z");
  });

  it("returns today's occurrence when today is the target day and the time hasn't passed yet", () => {
    const config = utcConfig({ mode: "WEEKLY", dayOfWeek: "TUESDAY" });
    const next = must(WeeklyScheduleStrategy.calculateNextRun(config, new Date("2026-09-08T00:00:00.000Z")));
    expect(next.toISOString()).toBe("2026-09-08T06:00:00.000Z");
  });

  it("throws when day_of_week is missing", () => {
    expect(() => WeeklyScheduleStrategy.calculateNextRun(utcConfig({ mode: "WEEKLY", dayOfWeek: null }), new Date())).toThrow();
  });
});

describe("CronScheduleStrategy", () => {
  it("computes the next occurrence for a daily-at-06:00 expression", () => {
    const config = utcConfig({ mode: "CRON", deliveryTimeLocal: null, cronExpression: "0 6 * * *" });
    const next = must(CronScheduleStrategy.calculateNextRun(config, new Date("2026-09-08T00:00:00.000Z")));
    expect(next.toISOString()).toBe("2026-09-08T06:00:00.000Z");
  });

  it("evaluates in the configured timezone", () => {
    const config = utcConfig({ mode: "CRON", timezone: "America/Detroit", deliveryTimeLocal: null, cronExpression: "0 6 * * *" });
    const next = must(CronScheduleStrategy.calculateNextRun(config, new Date("2026-09-08T00:00:00.000Z")));
    // 06:00 America/Detroit (EDT, UTC-4) on 2026-09-08 -> 10:00 UTC.
    expect(next.toISOString()).toBe("2026-09-08T10:00:00.000Z");
  });

  it("rejects a 6-field (seconds) expression", () => {
    expect(() => validateCronExpression("*/1 * * * * *")).toThrow(/5 fields/);
  });

  it("rejects an expression producing occurrences below the minimum interval", () => {
    expect(() => validateCronExpression("* * * * *", 3600)).toThrow(/below the configured minimum/);
  });

  it("accepts a well-formed 5-field expression", () => {
    expect(() => validateCronExpression("0 6 * * *")).not.toThrow();
  });

  it("rejects a malformed expression", () => {
    expect(() => validateCronExpression("nonsense")).toThrow();
  });
});
