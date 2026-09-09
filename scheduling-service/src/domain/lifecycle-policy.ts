// AGENTS.md section 28. Catalog's lifecycle statuses (data-product-catalog-
// service's own VERSION_LIFECYCLE_STATUSES: DRAFT/BETA/ACTIVE/DEPRECATED/
// RETIRED) are used as-is — never reinterpreted with conflicting semantics.
// Subscription Service has no explicit "I permit DEPRECATED/BETA" flag
// today, so the deliberate interpretation here is: a customer who pinned an
// EXACT version has explicitly chosen it (including a DEPRECATED/BETA one)
// — that IS the subscription policy permitting it. A floating policy
// (COMPATIBLE_MAJOR/LATEST_ACTIVE) only ever resolves to ACTIVE versions in
// the first place (CatalogHttpClient.resolveVersionPolicy filters to
// ACTIVE), so this function only sees DEPRECATED/BETA at all when paired
// with EXACT.
export function isLifecyclePublishable(lifecycleStatus: string, versionPolicyType: string): boolean {
  if (lifecycleStatus === "ACTIVE") return true;
  if (lifecycleStatus === "DEPRECATED" || lifecycleStatus === "BETA") return versionPolicyType === "EXACT";
  return false; // DRAFT, RETIRED, and any unrecognized status are never publishable.
}
