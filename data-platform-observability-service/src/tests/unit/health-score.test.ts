import { describe, expect, it } from "vitest";
import { computeHealth, type HealthWeights } from "../../domain/health/health-score.js";

const weights: HealthWeights = {
  sla: 0.3,
  freshness: 0.2,
  quality: 0.2,
  availability: 0.15,
  publicationSuccess: 0.1,
  retryFailure: 0.05,
};

describe("computeHealth", () => {
  it("returns HEALTHY with full component scores when everything is perfect", () => {
    const result = computeHealth(
      { sla: 100, freshness: 96, quality: 99, availability: 100, publicationSuccess: 98, retryFailure: 95 },
      weights,
    );
    expect(result.status).toBe("HEALTHY");
    expect(result.componentScores.freshness).toBe(96);
  });

  it("degrades status as the weighted score drops", () => {
    const result = computeHealth(
      { sla: 40, freshness: 60, quality: 70, availability: 80, publicationSuccess: 60, retryFailure: 50 },
      weights,
    );
    expect(["AT_RISK", "UNHEALTHY"]).toContain(result.status);
  });

  it("always exposes the component breakdown, never just a verdict", () => {
    const result = computeHealth(
      { sla: 0, freshness: 0, quality: 0, availability: 0, publicationSuccess: 0, retryFailure: 0 },
      weights,
    );
    expect(result.status).toBe("UNHEALTHY");
    expect(result.componentScores).toEqual({ sla: 0, freshness: 0, quality: 0, availability: 0, publicationSuccess: 0, retryFailure: 0 });
  });
});
