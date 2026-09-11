// AGENTS.md section 28. Catalog's lifecycle statuses (data-product-catalog-
// service's own VERSION_LIFECYCLE_STATUSES: DRAFT/BETA/ACTIVE/DEPRECATED/
// RETIRED) are used as-is — never reinterpreted with conflicting semantics.
//
// Phase 10 §29/§40: `resolveVersionPolicy` now delegates to Catalog's
// centralized resolver with intent="DELIVER", which already enforces the
// full consumption-gating table (spec §18) — DRAFT/RETIRED never
// resolvable, BETA only for opted-in tenants, DEPRECATED only within grace
// period. A resolved version has therefore already passed every rule this
// function used to reproduce locally (the pre-Phase-10 EXACT-vs-floating
// distinction was standing in for what the resolver's SUBSCRIBE/DELIVER
// intent split now does correctly, including DEPRECATED-in-grace-period
// for floating policies, which the old local logic never permitted).
// This stays only as defense-in-depth against a version genuinely never
// being publishable — Publication applies the same narrow check for the
// same reason (spec §40's "trust the already-gated resolution rather than
// re-implementing the gate, but a defensive check... is reasonable
// defense-in-depth").
export function isLifecyclePublishable(lifecycleStatus: string, _versionPolicyType: string): boolean {
  return lifecycleStatus !== "DRAFT" && lifecycleStatus !== "RETIRED";
}
