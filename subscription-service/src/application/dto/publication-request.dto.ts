// Spec §28 — the future Phase 7 -> Phase 4 contract. Defined now so Phase 7
// can be built against a stable shape, but Phase 6 never constructs or
// sends this (spec §47, invariant #14: "Phase 6 performs no scheduled
// execution"). Nothing in this codebase imports/calls this type as an
// executable action — it exists purely as a documented interface.
export interface PublicationRequestDTO {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;

  dataProductId: string;
  dataProductVersionId: string;
  resolvedVersion: string;

  deliveryMethod: string;
  requestedFormat: string | null;

  retentionDays: number | null;

  reason: "SCHEDULED" | "ON_DEMAND";

  correlationId: string;
}
