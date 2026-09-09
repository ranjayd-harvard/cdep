import type { EntitlementDecisionReason, EntitlementEffect } from "../config/constants.js";

// Row shape as persisted (src/infrastructure/persistence/entitlement.repository.ts).
// Domain logic never sees raw SQL rows — the repository maps into this shape.
export interface Entitlement {
  entitlementId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  effect: EntitlementEffect;
  validFrom: Date | null;
  validUntil: Date | null;
  reason: string | null;
  // Bookkeeping only (when/who last denied a previously-ALLOW decision) —
  // per spec §12's exact 4-rule evaluation order, revocation is expressed
  // through `effect: DENY`, not consulted separately here.
  revokedAt: Date | null;
  revokedBy: string | null;
  version: number;
}

export interface EntitlementDecision {
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  decision: "ALLOW" | "DENY";
  entitlementId: string | null;
  reason: EntitlementDecisionReason;
  evaluatedAt: string;
}

// Spec §12 — the exact, ordered rule set. Default-deny: nothing about
// product existence, prior uploads, or catalog visibility is allowed to
// substitute for an explicit ALLOW here (spec §12, invariant #7).
export function evaluateEntitlement(
  entitlement: Entitlement | null,
  organizationId: string,
  tenantId: string,
  dataProductId: string,
  evaluationTime: Date,
): EntitlementDecision {
  const base = { organizationId, tenantId, dataProductId, evaluatedAt: evaluationTime.toISOString() };

  if (!entitlement) {
    return { ...base, decision: "DENY", entitlementId: null, reason: "NO_ENTITLEMENT" };
  }

  if (entitlement.effect === "DENY") {
    return { ...base, decision: "DENY", entitlementId: entitlement.entitlementId, reason: "EXPLICIT_DENY" };
  }

  if (entitlement.validFrom && evaluationTime < entitlement.validFrom) {
    return { ...base, decision: "DENY", entitlementId: entitlement.entitlementId, reason: "NOT_YET_VALID" };
  }

  if (entitlement.validUntil && evaluationTime > entitlement.validUntil) {
    return { ...base, decision: "DENY", entitlementId: entitlement.entitlementId, reason: "EXPIRED" };
  }

  return { ...base, decision: "ALLOW", entitlementId: entitlement.entitlementId, reason: "ACTIVE_ENTITLEMENT" };
}
