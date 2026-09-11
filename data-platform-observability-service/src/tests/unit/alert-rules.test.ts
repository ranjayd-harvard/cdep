import { describe, expect, it } from "vitest";
import {
  apiAvailabilityBelowThreshold,
  businessSlaBreached,
  ingestionFailed,
  noDataReceived,
  pipelineFailed,
  publicationFailed,
  qualityThresholdBreached,
  repeatedRetries,
} from "../../domain/alerting/alert-rules.js";
import type { StageRunView } from "../../domain/execution.js";

function run(stage: StageRunView["stage"], status: StageRunView["status"], attemptNumber = 1): StageRunView {
  return { stage, status, attemptNumber, startedAt: null, completedAt: null };
}

describe("alert rules", () => {
  it("ingestionFailed fires only when Bronze ingestion's latest attempt failed", () => {
    expect(ingestionFailed([run("BRONZE_INGESTION", "FAILED")], "oexec-1")?.alertType).toBe("INGESTION_FAILED");
    expect(ingestionFailed([run("BRONZE_INGESTION", "SUCCEEDED")], "oexec-1")).toBeNull();
  });

  it("ingestionFailed ignores an earlier failed attempt superseded by a later success", () => {
    expect(ingestionFailed([run("BRONZE_INGESTION", "FAILED", 1), run("BRONZE_INGESTION", "SUCCEEDED", 2)], "oexec-1")).toBeNull();
  });

  it("pipelineFailed fires for Silver or Gold failure", () => {
    expect(pipelineFailed([run("GOLD_PRODUCT_BUILD", "FAILED")], "oexec-1")?.alertType).toBe("PIPELINE_FAILED");
    expect(pipelineFailed([run("SILVER_TRANSFORMATION", "SUCCEEDED"), run("GOLD_PRODUCT_BUILD", "SUCCEEDED")], "oexec-1")).toBeNull();
  });

  it("qualityThresholdBreached and publicationFailed fire on their respective stage failures", () => {
    expect(qualityThresholdBreached([run("QUALITY_VALIDATION", "FAILED")], "oexec-1")?.alertType).toBe("QUALITY_THRESHOLD_BREACHED");
    expect(publicationFailed([run("PUBLICATION", "FAILED")], "oexec-1")?.alertType).toBe("PUBLICATION_FAILED");
  });

  it("businessSlaBreached fires only on FAIL, carrying breach minutes in the description", () => {
    expect(businessSlaBreached("PASS", "oexec-1", null)).toBeNull();
    const alert = businessSlaBreached("FAIL", "oexec-1", 480);
    expect(alert?.alertType).toBe("BUSINESS_SLA_BREACHED");
    expect(alert?.description).toMatch(/8 minutes/);
  });

  it("repeatedRetries respects the configured threshold", () => {
    expect(repeatedRetries(2, "oexec-1", 3)).toBeNull();
    expect(repeatedRetries(3, "oexec-1", 3)?.alertType).toBe("REPEATED_RETRIES");
  });

  it("aggregate rules key on the supplied window bucket, not an execution id", () => {
    const alert = apiAvailabilityBelowThreshold(95, 99, "2026-09-09T05");
    expect(alert?.scopeKey).toBe("2026-09-09T05");
    expect(apiAvailabilityBelowThreshold(99.5, 99, "2026-09-09T05")).toBeNull();

    expect(noDataReceived(30, 60, "2026-09-09")).toBeNull();
    expect(noDataReceived(90, 60, "2026-09-09")?.alertType).toBe("NO_DATA_RECEIVED");
  });
});
