import { describe, expect, it } from "vitest";
import { recommendRetry } from "../../domain/retry-recommender.js";

describe("recommendRetry", () => {
  it("recommends retry with the owning service for a transient failure", () => {
    const result = recommendRetry({
      executionId: "oexec-1",
      failedStage: "PUBLICATION",
      errorCategory: "TRANSIENT_DEPENDENCY_FAILURE",
      errorMessage: "Gold snapshot not yet visible",
    });
    expect(result.retryRecommended).toBe(true);
    expect(result.retryOwner).toBe("data-publication-service");
    expect(result.safeFromStage).toBe("PUBLICATION");
  });

  it("does not recommend retry for a non-retriable failure category", () => {
    const result = recommendRetry({
      executionId: "oexec-1",
      failedStage: "GOLD_PRODUCT_BUILD",
      errorCategory: "PERMANENT_CONFIGURATION_FAILURE",
      errorMessage: null,
    });
    expect(result.retryRecommended).toBe(false);
    expect(result.retryOwner).toBe("data-lakehouse");
    expect(result.reason).toMatch(/intervention/);
  });
});
