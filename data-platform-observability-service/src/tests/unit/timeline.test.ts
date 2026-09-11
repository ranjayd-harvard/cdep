import { describe, expect, it } from "vitest";
import { buildTimeline, type StageRunTimelineInput } from "../../domain/timeline.js";

function run(partial: Partial<StageRunTimelineInput> & Pick<StageRunTimelineInput, "stage" | "status">): StageRunTimelineInput {
  return {
    sourceService: "test-service",
    sourceEntityId: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    errorMessage: null,
    ...partial,
  };
}

describe("buildTimeline", () => {
  it("orders entries chronologically across stages", () => {
    const timeline = buildTimeline([
      run({
        stage: "PUBLICATION",
        status: "SUCCEEDED",
        startedAt: new Date("2026-09-09T05:25:00Z"),
        completedAt: new Date("2026-09-09T05:31:00Z"),
      }),
      run({
        stage: "EXCHANGE_RECEIVED",
        status: "SUCCEEDED",
        startedAt: new Date("2026-09-09T05:00:00Z"),
        completedAt: new Date("2026-09-09T05:03:00Z"),
      }),
    ]);

    expect(timeline.map((e) => e.stage)).toEqual([
      "EXCHANGE_RECEIVED",
      "EXCHANGE_RECEIVED",
      "PUBLICATION",
      "PUBLICATION",
    ]);
    expect(timeline[0]!.timestamp.toISOString()).toBe("2026-09-09T05:00:00.000Z");
  });

  it("never includes raw error payloads, only the operationally-safe message", () => {
    const timeline = buildTimeline([
      run({
        stage: "PUBLICATION",
        status: "FAILED",
        completedAt: new Date("2026-09-09T05:31:00Z"),
        errorMessage: "artifact export timed out",
      }),
    ]);
    expect(timeline[0]!.message).toBe("PUBLICATION failed: artifact export timed out");
  });
});
