# subscription-service

Phase 6 — **Subscription & Entitlement Management** control plane for the CDEP platform.

## Purpose

This service answers two questions, and keeps them strictly separate:

```
ENTITLEMENT  = May this organization/tenant access this Data Product?
SUBSCRIPTION = How does this organization/tenant want to consume it?
```

An entitlement carries no scheduling/delivery preference. A subscription never grants access by
itself — it can only become `ACTIVE` when an effective entitlement currently permits it. Losing
entitlement suspends an `ACTIVE` subscription (`SUSPENDED` / `ENTITLEMENT_REVOKED`); it never
cancels it. This is the platform's single source of truth for entitlement/subscription decisions
going forward — see "Relationship to existing entitlement code" below for how it fits with what
already exists elsewhere in the repo.

This service does **not** schedule or execute anything. It declares consumer intent (version
policy, delivery method/format/frequency/retention) and exposes it through a stable read-only
internal contract. **Phase 7** will poll that contract, decide what's due, and construct a
`PublicationRequest` for **Phase 4** (`data-publication-service`) to execute.

```
Catalog (data-product-catalog-service)
        │  product + version
        ▼
Organization ──► Tenant ──► Entitlement ──ALLOW?──► Subscription
                                                        │
                                    ┌───────────────────┼────────────────────┐
                                    │                    │                    │
                              Version Policy      Delivery Method       Frequency
                                    │                    │                    │
                                    └───────────────────┼────────────────────┘
                                                        ▼
                                          Phase 7 Policy Engine (NOT in Phase 6)
                                                        ▼
                                                PublicationRequest
                                                        ▼
                                          Phase 4 Publication Service
                                                        ▼
                                                 Outbound Exchange
```

## Service boundaries

| Owns | Never does |
|---|---|
| **Catalog Service** (`data-product-catalog-service`) — DataProduct, DataProductVersion, lifecycle status, schema, supported delivery methods/formats | Doesn't know about entitlement or subscriptions |
| **subscription-service** (this repo) — Entitlement, Subscription, delivery preference, audit, idempotency | Doesn't define products/versions, doesn't call Publication Service, doesn't schedule |
| **Phase 7** (future) — due-time evaluation, `PublicationRequest` construction | N/A yet |
| **Publication Service** (`data-publication-service`) — publication execution, artifact generation, outbound handoff | Doesn't decide *when* to publish |

subscription-service stores only the Catalog's `dataProductId` (and resolves versions on demand
through the Catalog client) — it never creates a competing product/version definition.

## Relationship to existing entitlement code

"Entitlement" already exists in two other places in this repo, independently of each other:

- The portal's MongoDB `entitlements` collection (`src/lib/entitlement-directory.ts`).
- `data-exchange-service`'s own Postgres table `exchange.tenant_data_product_entitlements`,
  kept in sync with the above only by a best-effort push plus a manual reconciliation script
  (`npm run sync:cdep`) — see `docs/exchange-service-integration.md` for a documented drift
  incident this caused.

subscription-service is **additive** in this phase: it does not modify, replace, or read from
either of those systems. It is the intended future single source of truth (this is the same
direction `data-product-catalog-service` already took relative to the portal's old Mongo-native
product catalog), but retiring/migrating the two existing systems onto it is a deliberate,
separate decision outside this phase's scope.

## Domain model

- **Entitlement** — `organization_id + tenant_id + data_product_id → ALLOW | DENY`, with an
  optional validity window. One current decision per tenant/product (upserted, not accumulated).
  Default-deny: no entitlement row means DENY.
- **Subscription** — `PENDING → ACTIVE → {PAUSED, SUSPENDED, CANCELLED}`, centrally enforced by
  `src/domain/transition-rules.ts`. `CANCELLED` is terminal. Every transition into `ACTIVE`
  (create, activate, resume) reruns full eligibility: entitlement ALLOW, Catalog product active,
  version policy resolvable, delivery capability supported.
- **Version policy** — `EXACT` (a specific version), `COMPATIBLE_MAJOR` (`"1.x"` — highest ACTIVE
  version within that major, never crossing majors), `LATEST_ACTIVE` (`"latest"`). Stored as a
  policy, not a bound version — resolved against the Catalog on demand.
- **Delivery preference** — `FILE` (format/frequency/delivery_time/timezone/retention_days) or
  `API` (declarative profile only — no API keys/quotas/serving endpoints are built here).

## State machine

```
PENDING    → ACTIVE, CANCELLED
ACTIVE     → PAUSED, SUSPENDED, CANCELLED
PAUSED     → ACTIVE, SUSPENDED, CANCELLED
SUSPENDED  → ACTIVE, CANCELLED
CANCELLED  → (terminal)
```

## Data model

PostgreSQL, hand-rolled numbered-SQL-file migrations (no ORM/migration framework, matching every
other service in this repo). Tables: `entitlements`, `subscriptions`,
`subscription_delivery_preferences`, `subscription_audit_events` (append-only), `idempotency_records`.

`organization_id`/`tenant_id` are `VARCHAR(64)` slug-style ids (e.g. `org-vobis-org-722aea`) —
matching the platform-wide convention (see `data-exchange-service`'s migrations), not native UUIDs.

Only one *live* subscription exists per `(organization_id, tenant_id, data_product_id)` — enforced
by a partial unique index excluding `CANCELLED` rows, so a customer can re-subscribe after
cancelling without losing the cancelled row's history.

## Security model

- **Customer-facing** (`/v1/*`): bearer token, `AUTH_MODE=development|oidc`. In development, an
  unsigned base64url JSON payload (`{sub, organization_id, active_tenant_id, role}`) is decoded —
  the *same* dev bridge token format `data-exchange-service` accepts (see
  `docs/exchange-service-integration.md`), so the portal's existing `mintDevToken()` works against
  this service unchanged. `organization_id`/`tenant_id` always come from the token, never from
  request params/body. `AUTH_MODE=development` refuses to boot when `NODE_ENV=production`.
- **Internal** (`/internal/v1/*`): shared static key (`x-internal-api-key`) plus
  `x-actor-type`/`x-actor-id`/`x-actor-role` headers, matching `data-product-catalog-service`'s
  convention exactly.
- **Tenant isolation**: every repository query filters by `organization_id AND tenant_id`.
  Cross-tenant reads/mutations return `404` (never `403`) — existence must never leak across
  tenants.
- Entitlement grant/deny is internal-only (`ENTITLEMENT_ADMIN`/`PLATFORM_ADMIN`), never exposed to
  ordinary customer roles.

## Idempotency & concurrency

- `Idempotency-Key` header on subscription create/activate/pause/resume/cancel and entitlement
  grant: same key + same payload replays the stored result; same key + different payload → `409
  IDEMPOTENCY_KEY_REUSED`. Scoped by `(key, organization_id, tenant_id, operation)`.
- Optimistic concurrency via a `version` column on `entitlements`/`subscriptions`/delivery
  preferences — a stale-version update returns `409 CONCURRENT_MODIFICATION`.
- Every mutation writes its audit event in the same database transaction (never best-effort).

## API

Customer-facing (`/v1/*`):
```
GET    /v1/entitlements
GET    /v1/entitlements/products/{dataProductId}
POST   /v1/subscriptions
GET    /v1/subscriptions
GET    /v1/subscriptions/{id}
PATCH  /v1/subscriptions/{id}                  (version_policy and/or delivery)
POST   /v1/subscriptions/{id}/activate
POST   /v1/subscriptions/{id}/pause
POST   /v1/subscriptions/{id}/resume
POST   /v1/subscriptions/{id}/cancel
```

Internal (`/internal/v1/*`):
```
POST /internal/v1/entitlements
GET  /internal/v1/entitlements/{id}
PUT  /internal/v1/entitlements/{id}
POST /internal/v1/entitlements/{id}/allow
POST /internal/v1/entitlements/{id}/deny
POST /internal/v1/entitlements/evaluate

GET  /internal/v1/subscriptions/delivery-candidates?status=&data_product_id=
GET  /internal/v1/subscriptions/{id}/delivery-context   ← the Phase 7 contract
POST /internal/v1/subscriptions/{id}/suspend             (platform-controlled)
```

`delivery-candidates`/`delivery-context` are declarative only — no `next_run_at`, `last_run_at`,
or scheduler-lock fields. Due-time evaluation is entirely Phase 7's responsibility.

Full OpenAPI docs at `/docs` once the server is running.

## Phase 7 handoff

`src/application/dto/publication-request.dto.ts` documents the future `PublicationRequest`
contract Phase 7 will construct and Phase 4 will consume. It is defined now for a stable target
but never constructed or sent anywhere in this codebase.

## Local development

```bash
cp .env.example .env
docker compose up -d          # postgres + subscription-service (auto-migrates on boot)
# or, for iterative dev against a host-run Postgres:
docker compose up -d postgres
npm install
npm run migrate
npm run dev
```

Requires a running `data-product-catalog-service` (seeded per its own `npm run seed`) reachable at
`CATALOG_SERVICE_URL` — subscription creation/activation fails closed with `CATALOG_UNAVAILABLE`
if it isn't.

Ports: Postgres `5438`, service `8093` (next free in this repo's sequential allocation after
5437/8092 for `data-product-catalog-service`).

## Demo

```bash
npm run seed   # grants Vobis Org / Default Tenant ALLOW on Event Performance
npm run demo   # walks the full spec scenario end-to-end and prints each step
```

`npm run demo` reproduces: evaluate (DENY) → grant → evaluate (ALLOW) → create subscription
(ACTIVE) → read → pause → resume (reruns eligibility) → deny entitlement (subscription cascades to
SUSPENDED/`ENTITLEMENT_REVOKED`) → attempt reactivation while denied (rejected,
`PRODUCT_NOT_ENTITLED`) → restore entitlement → reactivate (ACTIVE) → fetch `delivery-context` —
then stops. Nothing is scheduled or published.

## Testing

```bash
npm test
```

- `src/tests/unit` — domain logic only (entitlement evaluation, state transitions, version policy
  parsing, delivery preference validation), no I/O.
- `src/tests/integration` — real Postgres: unique constraints (including the partial index),
  transaction rollback, optimistic concurrency, tenant-scoped queries, audit persistence,
  idempotency persistence.
- `src/tests/contract` — against a real running `data-product-catalog-service` (no Catalog
  internals re-implemented in a mock).
- `src/tests/e2e` — the full Vobis Org / Event Performance scenario end-to-end, plus dedicated
  multi-tenant isolation and idempotency-replay assertions.

Test files run sequentially (`fileParallelism: false`) because integration/contract/e2e suites
share one live Postgres database and `TRUNCATE` it between tests.

Requires: Postgres reachable at `DATABASE_URL` (`docker compose up -d postgres`, migrated) and
`data-product-catalog-service` reachable at `CATALOG_SERVICE_URL`, seeded with `event-performance`
(1.0.0 DEPRECATED, 1.1.0 ACTIVE, 2.0.0 DRAFT).
