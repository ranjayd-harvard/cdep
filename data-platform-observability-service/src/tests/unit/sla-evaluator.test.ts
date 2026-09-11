import { describe, expect, it } from "vitest";
import { evaluateBusinessSla, evaluateStageTarget, rollupSlaStatus } from "../../domain/sla/sla-evaluator.js";

describe("evaluateStageTarget (technical SLA)", () => {
  it("PASSes when the stage completes within its target", () => {
    const result = evaluateStageTarget(
      { targetMinutes: 15, actualStartedAt: new Date("2026-09-09T05:17:00Z"), actualCompletedAt: new Date("2026-09-09T05:24:00Z") },
      new Date("2026-09-09T05:24:00Z"),
    );
    expect(result.status).toBe("PASS");
    expect(result.breachDurationSeconds).toBeNull();
  });

  it("FAILs with a breach duration when the stage overruns its target", () => {
    const result = evaluateStageTarget(
      { targetMinutes: 15, actualStartedAt: new Date("2026-09-09T05:17:00Z"), actualCompletedAt: new Date("2026-09-09T05:33:00Z") },
      new Date("2026-09-09T05:33:00Z"),
    );
    expect(result.status).toBe("FAIL");
    expect(result.breachDurationSeconds).toBe(60);
  });

  it("is AT_RISK when still running past target with no completion yet", () => {
    const result = evaluateStageTarget(
      { targetMinutes: 15, actualStartedAt: new Date("2026-09-09T05:17:00Z"), actualCompletedAt: null },
      new Date("2026-09-09T05:47:00Z"),
    );
    expect(result.status).toBe("AT_RISK");
  });
});

describe("evaluateBusinessSla", () => {
  it("PASSes when delivery completes before the deadline", () => {
    // referenceTime + 4h = 05:30Z deadline; delivered at 05:29Z, 1 minute early.
    const result = evaluateBusinessSla(
      {
        deliveryDeadlineExpression: "T+4h",
        referenceTime: new Date("2026-09-09T01:30:00Z"),
        actualAvailableAt: new Date("2026-09-09T05:29:00Z"),
      },
      new Date("2026-09-09T05:29:00Z"),
    );
    expect(result.status).toBe("PASS");
  });

  it("FAILs with breach duration when delivery completes after the deadline", () => {
    // Demonstration scenario (spec section 39): Gold complete 05:58,
    // publication READY 06:08, business deadline 06:00 -> FAIL, breach 8 minutes.
    const result = evaluateBusinessSla(
      {
        deliveryDeadlineExpression: "daily 06:00 UTC",
        referenceTime: new Date("2026-09-09T01:00:00Z"),
        actualAvailableAt: new Date("2026-09-09T06:08:00Z"),
      },
      new Date("2026-09-09T06:08:00Z"),
    );
    expect(result.status).toBe("FAIL");
    expect(result.breachDurationSeconds).toBe(8 * 60);
  });

  it("FAILs once now() passes the deadline even with no delivery yet", () => {
    const result = evaluateBusinessSla(
      { deliveryDeadlineExpression: "T+4h", referenceTime: new Date("2026-09-09T01:00:00Z"), actualAvailableAt: null },
      new Date("2026-09-09T05:30:00Z"),
    );
    expect(result.status).toBe("FAIL");
  });

  it("is NOT_APPLICABLE for an expression Phase 9 doesn't support, never throwing", () => {
    const result = evaluateBusinessSla(
      { deliveryDeadlineExpression: "whenever it's ready", referenceTime: new Date(), actualAvailableAt: null },
      new Date(),
    );
    expect(result.status).toBe("NOT_APPLICABLE");
  });
});

describe("rollupSlaStatus", () => {
  it("FAIL dominates any other status", () => {
    expect(rollupSlaStatus(["PASS", "AT_RISK", "FAIL"])).toBe("FAIL");
  });
  it("AT_RISK dominates when nothing failed", () => {
    expect(rollupSlaStatus(["PASS", "AT_RISK"])).toBe("AT_RISK");
  });
  it("is PASS only when everything applicable passed", () => {
    expect(rollupSlaStatus(["PASS", "PASS", "NOT_APPLICABLE"])).toBe("PASS");
  });
  it("is NOT_APPLICABLE when nothing was applicable", () => {
    expect(rollupSlaStatus(["NOT_APPLICABLE"])).toBe("NOT_APPLICABLE");
  });
});
