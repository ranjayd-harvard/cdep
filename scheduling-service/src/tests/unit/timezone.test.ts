import { describe, expect, it } from "vitest";
import { calendarDateInZone, dayOfWeekInZone, zonedWallTimeToUtc } from "../../domain/timezone.js";

describe("zonedWallTimeToUtc", () => {
  it("converts a UTC wall time trivially", () => {
    const result = zonedWallTimeToUtc({ year: 2026, month: 9, day: 9, hour: 6, minute: 0, second: 0 }, "UTC");
    expect(result.toISOString()).toBe("2026-09-09T06:00:00.000Z");
  });

  it("converts a fixed-offset zone correctly (America/Detroit, EDT, summer)", () => {
    // 2026-08-08 06:00 America/Detroit (EDT, UTC-4) -> 10:00 UTC.
    const result = zonedWallTimeToUtc({ year: 2026, month: 8, day: 8, hour: 6, minute: 0, second: 0 }, "America/Detroit");
    expect(result.toISOString()).toBe("2026-08-08T10:00:00.000Z");
  });

  it("converts a fixed-offset zone correctly (America/Detroit, EST, winter)", () => {
    // 2026-01-08 06:00 America/Detroit (EST, UTC-5) -> 11:00 UTC.
    const result = zonedWallTimeToUtc({ year: 2026, month: 1, day: 8, hour: 6, minute: 0, second: 0 }, "America/Detroit");
    expect(result.toISOString()).toBe("2026-01-08T11:00:00.000Z");
  });

  it("converts India's half-hour offset correctly", () => {
    // 2026-06-01 06:00 Asia/Kolkata (UTC+5:30) -> 00:30 UTC.
    const result = zonedWallTimeToUtc({ year: 2026, month: 6, day: 1, hour: 6, minute: 0, second: 0 }, "Asia/Kolkata");
    expect(result.toISOString()).toBe("2026-06-01T00:30:00.000Z");
  });

  it("resolves a spring-forward gap to the next valid local instant", () => {
    // US DST 2026: clocks spring forward at 2026-03-08 02:00 America/New_York
    // -> 03:00 (EDT). 02:30 never occurs; policy says execute at the next
    // valid local instant, which is 03:00 EDT = 07:00 UTC.
    const result = zonedWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, "America/New_York");
    expect(result.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  it("resolves a fall-back overlap to exactly one (the earlier) occurrence", () => {
    // US DST 2026: clocks fall back at 2026-11-01 02:00 EDT -> 01:00 EST.
    // 01:30 occurs twice: 01:30 EDT (05:30 UTC) and 01:30 EST (06:30 UTC).
    // Policy: resolve to the earlier UTC instant, executing once.
    const result = zonedWallTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, "America/New_York");
    expect(result.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("resolves the ordinary time just before a spring-forward gap normally", () => {
    const result = zonedWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 1, minute: 59, second: 0 }, "America/New_York");
    expect(result.toISOString()).toBe("2026-03-08T06:59:00.000Z");
  });

  it("resolves the ordinary time just after a fall-back overlap normally", () => {
    // 2026-11-01 02:30 only ever occurs once, after the fall-back (EST).
    const result = zonedWallTimeToUtc({ year: 2026, month: 11, day: 1, hour: 2, minute: 30, second: 0 }, "America/New_York");
    expect(result.toISOString()).toBe("2026-11-01T07:30:00.000Z");
  });
});

describe("dayOfWeekInZone", () => {
  it("returns the correct weekday for a UTC instant", () => {
    // 2026-09-08 is a Tuesday.
    expect(dayOfWeekInZone(new Date("2026-09-08T12:00:00.000Z"), "UTC")).toBe("TUESDAY");
  });

  it("returns the weekday relative to the target zone, not UTC", () => {
    // 2026-09-08T23:30:00Z is Tuesday in UTC but already Wednesday in Tokyo (UTC+9).
    expect(dayOfWeekInZone(new Date("2026-09-08T23:30:00.000Z"), "Asia/Tokyo")).toBe("WEDNESDAY");
  });
});

describe("calendarDateInZone", () => {
  it("returns the local calendar date, not the UTC one, near a day boundary", () => {
    // 2026-09-08T23:30:00Z is already 2026-09-09 in Tokyo.
    expect(calendarDateInZone(new Date("2026-09-08T23:30:00.000Z"), "Asia/Tokyo")).toEqual({ year: 2026, month: 9, day: 9 });
  });
});
