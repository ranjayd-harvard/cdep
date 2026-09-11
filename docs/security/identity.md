# Identity & Authentication

## Provider

Local development uses **Keycloak** (`identity-provider/docker-compose.yml`, realm `cdep`, imported from `identity-provider/realm-export/cdep-realm.json`) as a stand-in OIDC provider. No business service talks to Keycloak's admin API or any vendor-specific SDK — every service only ever consumes three generic values, so swapping in Entra ID / Okta / Auth0 / Cognito for Phase 12 requires changing configuration, not code:

- `OIDC_ISSUER_URL` — compared against the token's `iss` claim.
- `OIDC_JWKS_URI` — where the verification public keys are fetched from (`jose`'s `createRemoteJWKSet`, cached and auto-refreshed).
- `OIDC_AUDIENCE` — compared against the token's `aud` claim.

These are deliberately separate env vars (not derived from one URL) because in Docker they are often genuinely different hostnames for the same IdP — see the comment in `identity-provider/docker-compose.yml`.

## Customer-facing verification

Implemented identically in `data-exchange-service`, `subscription-service`, `scheduling-service`, `data-platform-observability-service`, and `data-product-api-service` (`src/auth/{auth,customer-auth}.middleware.ts`, function `verifyProductionJwt`). `data-product-catalog-service` has no customer-facing routes and is not part of this path.

Verification checks, via `jose.jwtVerify`:
- signature (against the fetched JWKS)
- `iss` (must equal `OIDC_ISSUER_URL`)
- `aud` (must equal `OIDC_AUDIENCE`)
- `exp`/`nbf` (jose's default clock checks)
- algorithm allowlist: `RS256` only

Required claims mapped into the service's `SecurityContext`/`TenantContext`/`RequestContext` (name varies by service, shape now unified — see below): `sub` → user id, `organization_id`, `active_tenant_id`, and platform roles read from Keycloak's `realm_access.roles` claim, filtered to the service's known `Role` union. Any failure — bad signature, wrong issuer/audience, expired, missing claim, unrecognized role — collapses to the same `UNAUTHENTICATED`/`AUTHENTICATION_REQUIRED` error; the specific reason is never returned to the caller (spec §7/§32) and the raw token is never logged (existing pino `redact.paths` already covers `authorization`/`*.jwt`).

`AUTH_MODE=development` is unchanged from Phases 1–10 (decodes an unsigned token or falls back to a fixed dev profile) and remains blocked in production by the existing `env.ts` check. A new check alongside it: **`AUTH_MODE=oidc` now requires `OIDC_ISSUER_URL`/`OIDC_JWKS_URI`/`OIDC_AUDIENCE` to be set, or the service refuses to boot** — fail-closed, matching the existing pattern for `AUTH_MODE=development` in production.

## SecurityContext (unified shape)

Every service's context type (`RequestContext`/`TenantContext`/`SecurityContext`, in `src/auth/request-context.ts`) now carries:

```ts
{
  userId /* or subjectId */: string,
  organizationId: string,
  activeTenantId: string,
  role: Role,        // primary role, kept for existing role-equality checks
  roles: Role[],      // full verified role set
  authenticationMethod: "oidc" | "dev",  // ("OIDC" | "DEV_TOKEN" in data-product-api-service, its pre-existing naming)
}
```

This is a mirrored pattern (same shape, independent files), not a shared library — see the plan's architectural note on why (no npm workspace exists in this repo). `roles`/`authenticationMethod` are additive to every service except `data-product-api-service`, which already had this exact shape before Phase 11.

## Not yet done (tracked in the Phase 11 plan)

- Service-to-service identity still uses the legacy shared static key (M4).
- Portal → backend service token minting still uses the dev-token format, not a real Keycloak login-derived token, for its server-to-server calls (tracked as a Phase 11 follow-up item, not yet scheduled in a milestone — portal end-user auth itself is unaffected, it already uses NextAuth).
