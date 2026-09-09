import { describe, expect, it } from "vitest";
import { findLatestDueOccurrence, resolveMissedRun } from "../../domain/missed-run.js";
import { DailyScheduleStrategy } from "../../domain/strategies/daily.strategy.js";
import type { ScheduleConfig } from "../../domain/schedule.js";

describe("resolveMissedRun", () => {
  const missed = new Date("2026-09-08T06:00:00.000Z");

  it("SKIP policy never runs a missed occurrence", () => {
    const result = resolveMissedRun(missed, new Date("2026-09-08T06:05:00.000Z"), "SKIP", 360);
    expect(result).toEqual({ action: "SKIP", occurrenceToRun: null });
  });

  it("RUN_LATEST runs a recently-missed occurrence within the grace window", () => {
    const now = new Date("2026-09-08T08:15:00.000Z"); // 2h15m late
    const result = resolveMissedRun(missed, now, "RUN_LATEST", 360);
    expect(result).toEqual({ action: "RUN", occurrenceToRun: missed });
  });

  it("RUN_LATEST does not replay a stale occurrence outside the grace window", () => {
    const now = new Date("2026-09-10T06:00:00.000Z"); // two days late
    const result = resolveMissedRun(missed, now, "RUN_LATEST", 360);
    expect(result).toEqual({ action: "SKIP", occurrenceToRun: null });
  });

  it("treats exactly-on-time as within the grace window", () => {
    const result = resolveMissedRun(missed, missed, "RUN_LATEST", 360);
    expect(result.action).toBe("RUN");
  });
});

describe("findLatestDueOccurrence", () => {
  const config: ScheduleConfig = { mode: "DAILY", timezone: "UTC", deliveryTimeLocal: "06:00", dayOfWeek: null, cronExpression: null };

  it("returns the starting occurrence when nothing further is due", () => {
    const from = new Date("2026-09-08T06:00:00.000Z");
    const now = new Date("2026-09-08T06:05:00.000Z");
    const latest = findLatestDueOccurrence(DailyScheduleStrategy, config, from, now);
    expect(latest?.toISOString()).toBe("2026-09-08T06:00:00.000Z");
  });

  it("collapses multiple missed daily occurrences into the single latest one", () => {
    const from = new Date("2026-09-05T06:00:00.000Z"); // scheduler was down for days
    const now = new Date("2026-09-08T10:00:00.000Z");
    const latest = findLatestDueOccurrence(DailyScheduleStrategy, config, from, now);
    // 09-05, 09-06, 09-07, 09-08 all <= now; latest is 09-08.
    expect(latest?.toISOString()).toBe("2026-09-08T06:00:00.000Z");
  });

  it("returns null when the starting point is already in the future", () => {
    const from = new Date("2026-09-09T06:00:00.000Z");
    const now = new Date("2026-09-08T00:00:00.000Z");
    const latest = findLatestDueOccurrence(DailyScheduleStrategy, config, from, now);
    expect(latest).toBeNull();
  });
});
