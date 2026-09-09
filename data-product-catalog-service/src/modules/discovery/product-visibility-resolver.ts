// Spec §38: the Catalog stores global product definitions and must NOT bake
// per-tenant assumptions into product repository logic. Which tenant may
// see/use which product is Subscription/Entitlement's call (a future
// phase) — this is the seam that decision plugs into.
//
// The Phase 5 implementation is intentionally trivial: every discoverable
// product is visible to every caller. A future ProductVisibilityResolver
// would take a tenant/organization id and call out to an entitlement
// service; the customer-facing routes (product.routes.ts) already call
// through this interface rather than checking `discoverable` inline, so
// swapping the implementation later requires no route changes.
export interface ProductVisibilityResolver {
  isVisible(input: { dataProductId: string; discoverable: boolean; status: string }): boolean;
}

export const localProductVisibilityResolver: ProductVisibilityResolver = {
  isVisible({ discoverable, status }) {
    return discoverable && status === "ACTIVE";
  },
};
