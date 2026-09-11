import { describe, expect, it } from "vitest";
import { deriveExecutionState, type StageRunView } from "../../domain/execution.js";

function run(partial: Partial<StageRunView> & Pick<StageRunView, "stage" | "status">): StageRunView {
  return { attemptNumber: 1, startedAt: null, completedAt: null, ...partial };
}

describe("deriveExecutionState", () => {
  it("returns PENDING with no stage runs", () => {
    const result = deriveExecutionState([]);
    expect(result).toEqual({ currentStage: null, overallStatus: "PENDING", startedAt: null, completedAt: null });
  });

  it("reports RUNNING mid-pipeline when the latest stage succeeded but is not a delivery stage", () => {
    const started = new Date("2026-09-09T05:00:00Z");
    const result = deriveExecutionState([
      run({ stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED", startedAt: started, completedAt: new Date("2026-09-09T05:03:00Z") }),
      run({ stage: "BRONZE_INGESTION", status: "SUCCEEDED", startedAt: started, completedAt: new Date("2026-09-09T05:08:00Z") }),
    ]);
    expect(result.overallStatus).toBe("RUNNING");
    expect(result.currentStage).toBe("BRONZE_INGESTION");
    expect(result.completedAt).toBeNull();
  });

  it("reports SUCCEEDED once a delivery-terminal stage succeeds", () => {
    const completed = new Date("2026-09-09T05:33:00Z");
    const result = deriveExecutionState([
      run({ stage: "PUBLICATION", status: "SUCCEEDED" }),
      run({ stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED", completedAt: completed }),
    ]);
    expect(result.overallStatus).toBe("SUCCEEDED");
    expect(result.currentStage).toBe("OUTBOUND_EXCHANGE");
    expect(result.completedAt).toBe(completed);
  });

  it("reports FAILED at the earliest failed stage even if a later stage row exists", () => {
    const result = deriveExecutionState([
      run({ stage: "SILVER_TRANSFORMATION", status: "SUCCEEDED" }),
      run({ stage: "GOLD_PRODUCT_BUILD", status: "FAILED", completedAt: new Date("2026-09-09T05:20:00Z") }),
    ]);
    expect(result.overallStatus).toBe("FAILED");
    expect(result.currentStage).toBe("GOLD_PRODUCT_BUILD");
  });

  it("uses only the latest attempt per stage", () => {
    const result = deriveExecutionState([
      run({ stage: "PUBLICATION", status: "FAILED", attemptNumber: 1 }),
      run({ stage: "PUBLICATION", status: "SUCCEEDED", attemptNumber: 2, completedAt: new Date("2026-09-09T05:31:00Z") }),
    ]);
    expect(result.overallStatus).toBe("RUNNING");
    expect(result.currentStage).toBe("PUBLICATION");
  });
});
