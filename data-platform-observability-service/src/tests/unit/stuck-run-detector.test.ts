import { describe, expect, it } from "vitest";
import { detectStuckRun } from "../../domain/stuck-run-detector.js";

describe("detectStuckRun", () => {
  it("is not stuck when not RUNNING", () => {
    const result = detectStuckRun(
      { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED", startedAt: new Date("2026-09-09T05:00:00Z") },
      new Date("2026-09-09T06:00:00Z"),
      15,
    );
    expect(result.stuck).toBe(false);
  });

  it("is stuck once elapsed time exceeds the threshold", () => {
    const result = detectStuckRun(
      { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING", startedAt: new Date("2026-09-09T05:00:00Z") },
      new Date("2026-09-09T05:47:00Z"),
      15,
    );
    expect(result.stuck).toBe(true);
    expect(result.elapsedMinutes).toBeCloseTo(47, 0);
  });

  it("is not stuck while within the threshold", () => {
    const result = detectStuckRun(
      { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING", startedAt: new Date("2026-09-09T05:00:00Z") },
      new Date("2026-09-09T05:10:00Z"),
      15,
    );
    expect(result.stuck).toBe(false);
  });
});
