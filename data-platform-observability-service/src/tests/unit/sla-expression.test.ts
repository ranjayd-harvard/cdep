import { describe, expect, it } from "vitest";
import { computeDeadline, parseDeliveryDeadlineExpression } from "../../domain/sla/sla-expression.js";

describe("parseDeliveryDeadlineExpression", () => {
  it("parses a relative T+<n><unit> expression", () => {
    expect(parseDeliveryDeadlineExpression("T+4h")).toEqual({ kind: "RELATIVE", amount: 4, unit: "h" });
    expect(parseDeliveryDeadlineExpression("T+30m")).toEqual({ kind: "RELATIVE", amount: 30, unit: "m" });
  });

  it("parses a daily HH:MM <tz> expression", () => {
    expect(parseDeliveryDeadlineExpression("daily 06:00 UTC")).toEqual({ kind: "DAILY", hour: 6, minute: 0, timeZone: "UTC" });
  });

  it("returns null for an unrecognized expression rather than throwing", () => {
    expect(parseDeliveryDeadlineExpression("whenever it's ready")).toBeNull();
    expect(parseDeliveryDeadlineExpression("daily 26:00 UTC")).toBeNull();
  });
});

describe("computeDeadline", () => {
  it("computes a relative deadline from the reference time", () => {
    const deadline = computeDeadline({ kind: "RELATIVE", amount: 4, unit: "h" }, new Date("2026-09-09T02:00:00Z"));
    expect(deadline.toISOString()).toBe("2026-09-09T06:00:00.000Z");
  });

  it("computes a daily UTC deadline on the same calendar day as the reference time", () => {
    const deadline = computeDeadline({ kind: "DAILY", hour: 6, minute: 0, timeZone: "UTC" }, new Date("2026-09-09T02:00:00Z"));
    expect(deadline.toISOString()).toBe("2026-09-09T06:00:00.000Z");
  });

  it("computes a daily deadline in a non-UTC IANA zone", () => {
    // America/New_York is UTC-4 in September (EDT) — 06:00 local = 10:00
    // UTC. Reference time is 2026-09-09T14:00Z (10:00 local, still the
    // 9th in New York) so the computed deadline's calendar day matches.
    const deadline = computeDeadline(
      { kind: "DAILY", hour: 6, minute: 0, timeZone: "America/New_York" },
      new Date("2026-09-09T14:00:00Z"),
    );
    expect(deadline.toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });
});
