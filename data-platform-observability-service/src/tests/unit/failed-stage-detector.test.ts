import { describe, expect, it } from "vitest";
import { detectFailedStage } from "../../domain/failed-stage-detector.js";
import type { StageRunView } from "../../domain/execution.js";

function run(stage: StageRunView["stage"], status: StageRunView["status"], attemptNumber = 1): StageRunView {
  return { stage, status, attemptNumber, startedAt: null, completedAt: null };
}

describe("detectFailedStage", () => {
  it("returns null when nothing failed", () => {
    const result = detectFailedStage([run("EXCHANGE_RECEIVED", "SUCCEEDED"), run("BRONZE_INGESTION", "RUNNING")]);
    expect(result.failedStage).toBeNull();
    expect(result.downstreamBlocked).toBe(false);
  });

  it("identifies the earliest failed stage as the root cause", () => {
    const result = detectFailedStage([
      run("SILVER_TRANSFORMATION", "SUCCEEDED"),
      run("GOLD_PRODUCT_BUILD", "FAILED"),
      run("PUBLICATION", "FAILED"),
    ]);
    expect(result.failedStage).toBe("GOLD_PRODUCT_BUILD");
  });

  it("never marks a never-started downstream stage as failed, and reports it separately", () => {
    const result = detectFailedStage([run("PUBLICATION", "FAILED")]);
    expect(result.failedStage).toBe("PUBLICATION");
    expect(result.downstreamBlocked).toBe(true);
    expect(result.neverStartedStages).toEqual(["OUTBOUND_EXCHANGE", "FILE_DELIVERY", "API_DELIVERY"]);
  });

  it("uses the latest attempt per stage, not an earlier failed attempt", () => {
    const result = detectFailedStage([run("PUBLICATION", "FAILED", 1), run("PUBLICATION", "SUCCEEDED", 2)]);
    expect(result.failedStage).toBeNull();
  });
});
