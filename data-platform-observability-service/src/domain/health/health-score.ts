import type { HealthStatus } from "../../config/constants.js";

// Each component is a 0-100 score computed by health-evaluation.service.ts
// from that product/version's recent SLA evaluations, freshness/quality/
// availability metrics, publication success rate, and retry/failure rate.
export interface HealthComponentScores {
  sla: number;
  freshness: number;
  quality: number;
  availability: number;
  publicationSuccess: number;
  retryFailure: number;
}

export interface HealthWeights {
  sla: number;
  freshness: number;
  quality: number;
  availability: number;
  publicationSuccess: number;
  retryFailure: number;
}

export interface HealthResult {
  status: HealthStatus;
  score: number;
  componentScores: HealthComponentScores;
}

// Status bands are deliberately plain thresholds on the weighted score
// (spec section 17: "do not make the score a black box") — the API layer
// always returns componentScores alongside status/score, never just a
// verdict.
const STATUS_BANDS: ReadonlyArray<{ min: number; status: HealthStatus }> = [
  { min: 90, status: "HEALTHY" },
  { min: 70, status: "DEGRADED" },
  { min: 50, status: "AT_RISK" },
  { min: 0, status: "UNHEALTHY" },
];

export function computeHealth(components: HealthComponentScores, weights: HealthWeights): HealthResult {
  const score =
    components.sla * weights.sla +
    components.freshness * weights.freshness +
    components.quality * weights.quality +
    components.availability * weights.availability +
    components.publicationSuccess * weights.publicationSuccess +
    components.retryFailure * weights.retryFailure;

  const rounded = Math.round(score * 100) / 100;
  const band = STATUS_BANDS.find((b) => rounded >= b.min) ?? STATUS_BANDS[STATUS_BANDS.length - 1]!;

  return { status: band.status, score: rounded, componentScores: components };
}
