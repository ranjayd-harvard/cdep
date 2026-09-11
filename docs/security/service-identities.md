# Service Identity & Least Privilege

## Mechanism (implemented)

`src/security/service-identity.ts` (mirrored across every TS service — `data-exchange-service`, `data-product-catalog-service`, `subscription-service`, `scheduling-service`, `data-platform-observability-service`, `data-product-api-service`) implements a cloud-neutral `ServiceIdentityProvider` (spec §14/§46):

- `mintServiceToken(secret, { sub, aud, role })` — signs a short-lived (60s) HS256 JWT: `sub` = calling service name, `aud` = target service name, `role` claim = the actor role being asserted.
- `verifyServiceToken(secret, token, audience)` — verifies signature, audience, and expiry; returns the verified `sub`/`role`.

This replaces trusting a plaintext `x-actor-role` header (which any holder of the shared static key could set to anything, including `PLATFORM_ADMIN`) with a **signed, time-boxed claim** — the role is inside the token payload the receiving service cryptographically verified, not a header the caller can freely declare. The signing secret is the same per-relationship env var that existed before (e.g. `SUBSCRIPTION_SERVICE_INTERNAL_API_KEY`); Phase 11 changes how it's used (sign vs. raw-compare), not where it comes from — Phase 12 can swap it for a KMS-backed secret or workload-identity credential without changing this interface.

Wire format: the caller sends the signed token in a **new** header, `x-service-token`, alongside the legacy `x-internal-api-key` + `x-actor-*` headers (unchanged, sent as-is). This is deliberately additive — a callee that hasn't been rebuilt yet simply ignores the header it doesn't recognize and authenticates exactly as before, so migrating a caller can never break an unmigrated or not-yet-redeployed sibling. A migrated callee's `requireInternalAuth()`:

1. Verifies `x-service-token` if present → uses its verified `sub`/`role`, ignoring the legacy headers entirely.
2. If absent/invalid and `NODE_ENV=production` → rejected (fail closed — production never accepts the legacy path).
3. If absent/invalid and not production → falls back to the legacy static-key + plaintext-actor-header comparison, so existing dev/test fixtures keep working during the transition.

## Rollout status

**Fully migrated (both caller and callee updated, tested end-to-end):** every caller of `subscription-service`'s `/internal/v1/*` API — `scheduling-service` (`subscription-service-fetch.ts`), `data-product-api-service` (`subscription-service-fetch.ts`), and `data-platform-observability-service` (`subscription-http-client.ts`) — against `subscription-service`'s `internal-auth.middleware.ts`.

**Not yet migrated** (still legacy static-key + actor-header only, refused in production by the `NODE_ENV` guard added to every service's `env.ts` but not yet carrying a verifiable signed token): `data-product-catalog-service` as a callee (called by `subscription-service`, `scheduling-service`, `data-product-api-service`, the portal), `scheduling-service` as a callee (called by the portal / manual triggers), `data-publication-service`/`data-lakehouse`/`serving-projection-service` (Python — same static-key pattern, no signed-token support ported yet), and `data-exchange-service` as a callee. Each follows the exact pattern demonstrated above; migrating them is mechanical but was not completed in this pass given the size of the caller/callee/test-fixture surface (60+ files reference the legacy header today).

## Least-privilege roles asserted today

| Caller | Callee | Role asserted | Notes |
|---|---|---|---|
| `scheduling-service` | `subscription-service` | `SCHEDULER_READER` | read-only entitlement/delivery-context checks |
| `data-product-api-service` | `subscription-service` | `DATA_PRODUCT_API_READER` | read-only entitlement/subscription-resolve checks |
| `data-platform-observability-service` | `subscription-service` | `SERVICE` | corrected from a pre-existing `PLATFORM_ADMIN` over-claim for a read-only status lookup |

## Service MAY / MAY NOT (representative, extend as more relationships migrate)

```text
scheduling-service
  MAY:     read subscriptions/entitlements (subscription-service), resolve product versions
           (catalog-service), request publication (publication-service)
  MAY NOT: modify contracts, read arbitrary customer uploads, change entitlements

data-product-api-service
  MAY:     read entitlements/subscriptions (subscription-service), resolve API contracts
           (catalog-service), read the serving store
  MAY NOT: write to the serving store, modify catalog/subscription state

data-platform-observability-service
  MAY:     read operational/delivery status from every sibling service
  MAY NOT: modify state in any sibling service (poller is read-only by construction)
```
