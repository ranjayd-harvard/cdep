import type { ExchangeRow } from "../modules/exchanges/exchange.types.js";

// RetentionPolicy (spec §23) — deliberately one policy today, not a
// per-classification table: this service's only retention-eligible
// resource is the outbound artifact, whose eligibility is already fully
// expressed by the existing expires_at/status columns rather than a
// separate retention-days clock. Extending to more granular
// classification-scoped policies is additive (see docs/security/
// retention-deletion.md).
export interface RetentionPolicy {
  policyId: string;
  name: string;
  retentionDays: number | null;
  disposition: "DELETE" | "ARCHIVE" | "ANONYMIZE" | "REVIEW";
  classificationScope: readonly string[] | null;
  legalHoldSupported: boolean;
}

export const OUTBOUND_ARTIFACT_RETENTION_POLICY: RetentionPolicy = {
  policyId: "outbound-artifact-default",
  name: "Outbound artifact default retention",
  // null: retention is driven by the exchange's own contract-configured
  // expires_at (spec §31's publication.expirationHours), not a fixed
  // day-count independent of it.
  retentionDays: null,
  disposition: "DELETE",
  classificationScope: null,
  legalHoldSupported: true,
};

export type RetentionIneligibleReason = "NOT_OUTBOUND" | "NOT_EXPIRED" | "LEGAL_HOLD";

export type RetentionEligibility = { eligible: true } | { eligible: false; reason: RetentionIneligibleReason };

// Pure decision function (spec §23) — deliberately simple/testable, no
// hidden clock or I/O.
export function evaluateRetentionEligibility(exchange: Pick<ExchangeRow, "direction" | "status" | "legal_hold">): RetentionEligibility {
  if (exchange.direction !== "OUTBOUND") return { eligible: false, reason: "NOT_OUTBOUND" };
  if (exchange.status !== "EXPIRED") return { eligible: false, reason: "NOT_EXPIRED" };
  if (exchange.legal_hold) return { eligible: false, reason: "LEGAL_HOLD" };
  return { eligible: true };
}
