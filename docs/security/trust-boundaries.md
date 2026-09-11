# Trust Boundaries

## Diagram

```text
INTERNET
   │
   ▼
┌───────────────────────────────────────────────────────────┐
│ PUBLIC TRUST BOUNDARY                                      │
│                                                              │
│ Customer Portal (Next.js, NextAuth session)                 │
│ Keycloak (local OIDC IdP, :8180)                             │
│ Public host ports of every backend service (customer routes)│
└───────────────────────────┬──────────────────────────────────┘
                             │ Bearer JWT (OIDC access token)
                             ▼
┌───────────────────────────────────────────────────────────┐
│ APPLICATION TRUST BOUNDARY                                  │
│                                                              │
│ data-exchange-service        data-product-catalog-service   │
│ subscription-service         scheduling-service              │
│ data-publication-service     data-product-api-service        │
│ data-platform-observability  data-lakehouse                  │
│ serving-projection-service                                    │
│                                                              │
│ (service-to-service calls: signed service-identity JWT)      │
└───────────────────────────┬──────────────────────────────────┘
                             │ pg wire protocol / S3 API (internal network only)
                             ▼
┌───────────────────────────────────────────────────────────┐
│ DATA TRUST BOUNDARY                                          │
│                                                              │
│ PostgreSQL (one instance per service, least-privilege roles) │
│ MinIO / S3-compatible object storage (exchange, lakehouse)   │
│ Bronze / Silver / Gold (Iceberg on object storage)            │
│ MongoDB (portal control-plane data)                           │
└───────────────────────────────────────────────────────────┘
```

## Public trust boundary

| Identity | Credential | Protocol | Authorization check | Notes |
|---|---|---|---|---|
| Customer browser session (portal) | NextAuth session cookie (JWT strategy) | HTTPS | `requireTenantContext()` / role predicates in `src/lib/authorization.ts` | Password (bcrypt) or Google OAuth |
| Customer / third-party API client | OIDC access token (Keycloak-issued, `Bearer`) | HTTPS | `authenticate()` in each service's `auth/{auth,customer-auth}.middleware.ts` | Signature/iss/aud/exp verified via JWKS (see [identity.md](identity.md)) |
| Anonymous | none | HTTPS | Denied — every customer route requires `requireAuth()` | No public unauthenticated data endpoints exist |

Sensitive data crossing this boundary: authenticated request bodies/query results only, always after tenant + entitlement checks. No database or storage endpoint is exposed directly to the internet. Expected network restriction: only the portal, Keycloak, and each backend service's public API port are reachable from outside the docker host; in production this narrows to an edge/gateway in front of the portal and public APIs only.

## Application trust boundary

| Identity | Credential | Protocol | Authorization check | Notes |
|---|---|---|---|---|
| Calling service (e.g. scheduling-service → publication-service) | Short-lived signed service-identity JWT (`sub`=caller, `aud`=callee, `role`) | HTTP (internal) | `requireInternalAuth(minimumRole)` verifies signature+aud+exp, then checks the verified role | Replaces the legacy shared static `x-internal-api-key` + self-asserted actor headers (see [service-identities.md](service-identities.md)) |
| Human operator (CLI/admin scripts) | Same signed-JWT mechanism, minted for an operator identity | HTTP (internal) | Same as above | No standing shared secret usable by every caller |

Sensitive data crossing this boundary: tenant-scoped business data (subscriptions, entitlements, contract metadata, execution records) passed only after the caller's service identity and role are verified. Database credentials, object-storage credentials, and signing secrets never cross this boundary — they live only inside the owning service's process. Expected network restriction: these ports are not customer-reachable in production; only sibling services and the portal's server-side code call them.

## Data trust boundary

| Identity | Credential | Protocol | Authorization check | Notes |
|---|---|---|---|---|
| Owning service's application role | Password-authenticated least-privilege Postgres role (`app_<service>`), distinct from the migration/owner role | pg wire protocol | PostgreSQL RLS (`FORCE ROW LEVEL SECURITY`) + per-request `SET LOCAL app.organization_id/app.tenant_id` | See [tenant-isolation.md](tenant-isolation.md) |
| Migration runner | Owner-privileged Postgres role, used only by `scripts/run-migrations.ts` / `alembic`/SQL migration scripts, never by the running application | pg wire protocol | N/A (offline/CI operation) | Never used as the application's runtime connection |
| Owning service's storage credential | S3-compatible access key/secret (MinIO locally) | S3 API (internal network) | Object keys are always server-generated (`organizations/{orgId}/tenants/{tenantId}/...`); no customer input reaches key construction | See [data-classification.md](data-classification.md) for what may be stored here |

No credential in this boundary is ever handed to a customer or another service directly — access to data here is always mediated by the owning service's application code. Expected network restriction: Postgres and object-storage ports are not customer-reachable and, in production, not reachable from any service other than their owner.
