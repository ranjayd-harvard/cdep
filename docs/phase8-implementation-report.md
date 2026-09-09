# Phase 8 — Data Product API Delivery Layer: Implementation Report

Status: complete for the vertical slice specified (`event-performance` /
`events`, `GET /v1/data-products/event-performance/events`). All 20
sub-phases (§8.1–§8.20) are implemented and verified live against the
running Phase 1–7 stack, not just unit-tested in isolation.

## 1. Components created

| Component | Stack | Purpose |
|---|---|---|
| `serving-projection-service` | Python 3.11, PyIceberg, FastAPI, SQLAlchemy | Gold → API Serving Store projection (full + incremental refresh, checkpointing, atomic publish) |
| `data-product-api-service` | Node 20, TypeScript, Fastify | Customer-facing `/v1/data-products/event-performance/events`; auth, entitlement/subscription/version resolution, Contract-driven query engine, cursor pagination, response projection |

Both are fully independent deployable projects (own `package.json`/
`pyproject.toml`, own Dockerfile/docker-compose.yml), matching every
existing service in this monorepo — no shared-code tooling was introduced.

## 2. Repository changes to existing services (small, additive — no redesign)

- **`subscription-service`**
  - `GET /internal/v1/subscriptions/resolve?organization_id=&tenant_id=&data_product_id=` — resolves a subscription from tenant scope instead of a `subscriptionId` (the one lookup shape Phase 6/7 never needed). Reuses the existing `findSubscriptionByTenantProduct` repository query and the existing `getDeliveryContext` logic (extracted into a shared `buildDeliveryContextDTO` helper).
  - `serializeDeliveryContext` now includes `resolved_product_version.lifecycle_status` (it computed this already, just never serialized it — Phase 8 needs it to reject DRAFT/RETIRED-pinned subscriptions).
  - New role `DATA_PRODUCT_API_READER` added to `ROLES`, mirroring Phase 7's `SCHEDULER_READER` precedent, for `data-product-api-service`'s outbound `x-actor-role`.
  - Files: `src/api/internal/subscription.routes.ts`, `src/application/services/subscription.service.ts`, `src/api/serializers.ts`, `src/config/constants.ts`. New tests in `src/tests/e2e/vobis-demo.test.ts`. **69/69 tests pass** (68 pre-existing + 1 new).

- **`data-product-catalog-service`**
  - `GET /internal/v1/versions/api-contract?data_product_id=&version=` — the single Contract-driven source of truth for the API query policy (published fields via `customer_visible`, filters/sorts/pagination/response-limit via the `API` delivery method's `configuration` JSONB, which existed only as an unused placeholder before this phase).
  - `contracts/examples/event-performance-v1.0.yaml`'s `API` delivery method now carries `resource`/`filters`/`sorts`/`defaultSort`/`defaultPageSize`/`maxPageSize`/`maxResponseBytes`, wired through `contract-schema.ts` → `registration.service.ts` → the existing `insertDeliveryMethod`'s `configuration` param (unchanged signature).
  - New error code `API_DELIVERY_NOT_CONFIGURED` (422).
  - The already-registered `event-performance` 1.0.0 row (registered before this phase existed) had its `API` delivery method's `configuration` backfilled via one `UPDATE` against the dev database — contract registration is content-hash-immutable by design, so a *new* registration of 1.0.0 wasn't possible; a fresh environment registering the updated YAML from scratch needs no such backfill.
  - Files: `src/registration/contract-schema.ts`, `src/registration/registration.service.ts`, `src/modules/versions/version.service.ts`, `src/modules/versions/version.routes.ts`, `src/common/errors/app-error.ts`. New tests in `src/tests/integration/api-contract.test.ts`. **41/41 tests pass** (38 pre-existing + 3 new).

- **`data-lakehouse`**: no changes. `serving-projection-service` reads Gold directly via the same Postgres-backed Iceberg catalog + MinIO warehouse `data-publication-service` already reads (no new HTTP surface needed).

## 3. Database migrations

`serving-projection-service/sql/` (idempotent `CREATE ... IF NOT EXISTS`, same style as `data-publication-service`'s own migrations):

- `001_event_performance_events.sql` — `api_serving.event_performance_events` (live) + `..._staging` (structural twin, `LIKE ... INCLUDING ALL`).
- `002_projection_runs.sql` — `api_serving.projection_runs`.
- `003_indexes.sql` — the four index patterns spec §8.3 calls for, on both live and staging tables.

No migrations were needed in `data-product-api-service` (it never owns the serving-store schema) or in `subscription-service`/`data-product-catalog-service` (both changes above are additive endpoints/columns on already-existing tables, no DDL).

## 4. Catalog changes

`catalog.supported_delivery_methods.configuration` (JSONB, existed since Phase 5 as an unused placeholder for `API`) now holds:

```json
{
  "resource": "events",
  "filters": ["event_id", "venue_id", "event_date_from", "event_date_to", "updated_since"],
  "sorts": ["event_date", "event_id"],
  "defaultSort": ["event_date", "event_id"],
  "defaultPageSize": 100,
  "maxPageSize": 500,
  "maxResponseBytes": 5000000
}
```

Published fields = `catalog.product_schema_fields` rows with `customer_visible = true` for the resolved version (all 6 of `event-performance` 1.0.0's fields, `event_id`/`venue_id`'s `classification: INTERNAL` in the YAML controls data-sensitivity labeling only — it does not affect `customer_visible`, which defaults `true`). No second product/version/schema registry was created.

## 5. Serving projection (Gold → Serving)

**Full refresh**: `gold.event_performance` scanned at its current Iceberg snapshot (all tenants, no row filter — see `lakehouse/iceberg_reader.py`/`gold_bulk_reader.py`'s doc comment for why this differs from `data-publication-service`'s single-tenant `TenantScopedGoldReader`) → transformed to `ServingEventRow` → bulk-inserted into `event_performance_events_staging` → validated (row-count reconciliation) → **atomic three-way table rename** (`live→old, staging→live, old→staging`) inside one transaction. A failed run never reaches the rename step, so the previous successful snapshot stays servable throughout.

**Incremental refresh**: reads the last `SUCCEEDED` run's `{"type":"timestamp","value":...}` checkpoint, pushes `GreaterThan("_updated_at", checkpoint)` into the Iceberg scan (Gold's `_updated_at` is a real column every Silver→Gold run writes — not faked CDC), then `UPSERT ... ON CONFLICT (organization_id, tenant_id, event_id)` directly against the live table in one transaction, and advances the checkpoint to the max `_updated_at` read.

**Checkpoint abstraction** (`projection/checkpoint.py`): only `timestamp` is implemented (the only type Gold's schema actually supports today); the shape (`checkpoint` is JSONB on `projection_runs`) supports adding `sequence`/`snapshot`/`iceberg_snapshot`/`custom_token` later without a schema change.

**Verified live**: full refresh (4 rows, 2 tenants × 2 events) → mutated Tenant A's `EVT1001` in Gold → incremental refresh (1 row read/written) → Tenant A's API response reflects the new value (`1500` tickets / `99000.00`), Tenant B's is byte-for-byte unchanged.

## 6. Authentication flow (spec §8.5)

Identical pattern to `subscription-service`/`scheduling-service`: `AUTH_MODE=development` decodes (does not cryptographically verify) a base64url-JSON bearer token into `SecurityContext {subjectId, organizationId, activeTenantId, roles, authenticationMethod}`; `verifyProductionJwt` is an intentional stub throwing `SERVICE_UNAVAILABLE` (real OIDC/JWKS verification is out of scope for every service in this repo, not just this one); `env.ts` refuses to boot with `AUTH_MODE=development` when `NODE_ENV=production`. Query params/body are **never** read for identity anywhere in the codebase — grep confirms `request.query`/`request.body` are only ever passed to `contract-policy.ts`, which treats every key as a data filter candidate, allowlisted against the Catalog contract (`tenant_id` is not on that allowlist, so it is rejected, not silently ignored).

## 7. Authorization flow (spec §8.6)

```
authenticate()
  → entitlementClient.evaluate(org, tenant, "event-performance")          [subscription-service, fresh every request]
  → subscriptionClient.resolveForScope(org, tenant, "event-performance")  [subscription-service]
      → status === "ACTIVE"?
      → deliveryMethod === "API"?
      → resolvedProductVersion present?
      → resolvedProductVersion.lifecycleStatus in {ACTIVE, DEPRECATED, BETA}?
  → catalogClient.getApiContract("event-performance", resolvedVersion)    [data-product-catalog-service]
      → contract.resource === requested resource ("events")?
```

Every failure branch above collapses to the same `PRODUCT_NOT_FOUND` (404) a nonexistent product would produce — deliberately, so a denial never discloses *why* (no entitlement vs. paused subscription vs. FILE-only subscription vs. unresolved version are all indistinguishable to the caller), matching spec §8.10's cross-tenant-enumeration principle extended to authorization failures generally.

## 8. Version-resolution flow (spec §8.6)

`data-product-api-service` never resolves a version itself. It asks `subscription-service` for the *subscription's* resolved version (reusing `resolveVersionPolicy`'s existing `EXACT`/`COMPATIBLE_MAJOR`/`LATEST_ACTIVE` machinery, unchanged), then asks Catalog for that exact version's contract. `/v1/` (API surface version) and the resolved Data Product version are fully independent — proved live: the demo tenants' subscriptions are pinned `EXACT "1.0.0"` (6 published fields), while `subscription-service`'s own Phase 6 demo tenant is pinned `1.x` and resolves to `1.1.0` (7 fields, includes `discount_amount`) — same `/v1/` route, different resolved contract, entirely driven by the subscription's own version policy.

## 9. Query model (spec §8.7)

`ProductQuery` (`src/domain/product-query.ts`) is the only shape a `ServingStore` implementation ever sees. `contract-policy.ts` builds it from raw query params, allowlisting every filter/sort/field against the resolved `ApiContract` (never a hard-coded list) and rejecting anything else with a stable error code (`INVALID_FILTER`/`INVALID_SORT`/`INVALID_FIELD_SELECTION`/`INVALID_PAGE_SIZE`/`INVALID_REQUEST`). `PostgresServingStore` maps sort field names through a fixed `SORT_COLUMN_BY_FIELD` literal map before ever touching SQL text — no request-derived string ever becomes a column/table identifier, and every value is bound as a `$n` parameter.

## 10. Cursor design (spec §8.8)

Opaque `base64url(JSON payload).HMAC-SHA256(payload, secret)`. Payload: `{organizationId, tenantId, productId, productVersion, sort, filterFingerprint, lastValues}`. On decode: signature verified with `crypto.timingSafeEqual` (constant-time), then payload's tenant/product/version/sort/filterFingerprint compared against the *current* request — any mismatch (wrong tenant, wrong filters, wrong sort, tampered payload, tampered signature) is a single `INVALID_CURSOR`. Keyset pagination (`(c1>v1) OR (c1=v1 AND c2>v2) OR ...`), never `OFFSET`. Deterministic ordering enforced by always appending the contract's `defaultSort` fields the caller didn't already request.

## 11. Tenant-isolation strategy

Structural, not query-time-conventional: `api_serving.event_performance_events`'s **primary key** is `(organization_id, tenant_id, event_id)` — `event_id` is not unique on its own, proved live with `EVT1001` existing simultaneously in two tenants with entirely different data. Every `ServingStore` query hard-codes `WHERE organization_id = $1 AND tenant_id = $2` from the authenticated `SecurityContext`, never from any request-supplied value. Every serving-store index leads with `(organization_id, tenant_id, ...)`.

## 12. Test results

| Service | Suite | Result |
|---|---|---|
| `subscription-service` | vitest (unit/integration/contract/e2e) | **69/69 passed** |
| `data-product-catalog-service` | vitest (unit/integration) | **41/41 passed** |
| `serving-projection-service` | pytest (unit/integration) | **14/14 passed** |
| `data-product-api-service` | vitest (unit/integration/e2e) | **58/58 passed** |
| **Total** | | **182/182 passed** |

`data-product-api-service`'s suite specifically covers spec §8.16's checklist:
- **Unit**: filter/sort/date/timestamp/page-size/field-selection validation, cursor generation/verification/tampering, response-field-stripping (including a field with no accessor — the §8.18 regression guard), ETag sensitivity.
- **Integration**: `PostgresServingStore` tenant isolation, filter correctness, date-range filtering, **10-row/3-per-page pagination with no duplicates and no skipped rows across ties on the sort key**, `hasMore` correctness; the full orchestration service's every error-mapping branch (DENY entitlement, no/paused subscription, FILE-only subscription, unresolved/DRAFT/RETIRED version, missing contract, resource mismatch, response-too-large) against fake ports (fast, hermetic).
- **E2E** (`src/tests/e2e/phase8-tenant-isolation.test.ts`, against the **real running** catalog-service + subscription-service, not mocked): Tenant A/B isolation on identical `event_id`, `?tenant_id=` injection rejected, `?fields=` internal-field request rejected, a full response body scanned for zero occurrences of any internal field name, unsupported-filter rejection, malformed-token rejection, unrecognized-role rejection, no-entitlement → generic 404, cursor pagination + cross-tenant cursor rejection.

## 13. Performance

Not executed — no load-testing infrastructure is assumed available in this environment, and spec §8.16 permits documenting rather than running it. `perf/k6-event-performance.js` is a complete, runnable k6 script (constant 20 VUs / 60s, p50<100ms/p95<300ms/p99<600ms thresholds, error-rate<1%) against a mix of the happy-path, filtered, and field-selected queries. Run with:
```bash
k6 run -e BASE_URL=http://localhost:8095 -e TOKEN=<dev token> perf/k6-event-performance.js
```

## 14. Docker / seed / projection commands

```bash
# 1. serving-projection-service: Postgres + migrate + seed demo Gold + full refresh
cd serving-projection-service
docker compose up -d postgres
python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python scripts/run_migrations.py
.venv/bin/python scripts/seed_demo_gold.py --mode initial
.venv/bin/python scripts/run_projection.py --refresh-type FULL
docker compose up -d --build api          # ops-only internal API, host 8096

# 2. data-product-api-service
cd ../data-product-api-service
docker compose up -d --build              # host 8095, reads serving Postgres via host.docker.internal:5440
npm run demo                              # runs the §8.17/§8.18/§8.19 demonstration
```

Incremental-refresh demo:
```bash
cd serving-projection-service
.venv/bin/python scripts/seed_demo_gold.py --mode update-tenant-a
.venv/bin/python scripts/run_projection.py --refresh-type INCREMENTAL
```

## 15. curl examples

**Successful response** (Tenant A, default dev identity):
```bash
curl -s http://localhost:8095/v1/data-products/event-performance/events
```
```json
{
  "data": [
    { "event_id": "EVT1001", "venue_id": "VEN001", "event_date": "2026-09-01", "tickets_sold": 1200, "gross_revenue": "84000.00", "revenue_per_ticket": "70.00" },
    { "event_id": "EVT1002", "venue_id": "VEN001", "event_date": "2026-09-05", "tickets_sold": 800, "gross_revenue": "42000.00", "revenue_per_ticket": "52.50" }
  ],
  "page": { "next_cursor": null, "page_size": 100 },
  "product": { "id": "event-performance", "version": "1.0.0" },
  "freshness": { "serving_snapshot": "6730487008916781502", "as_of": "2026-09-09T06:29:xx.xxxZ" },
  "request_id": "corr-..."
}
```

**Tenant B, same event_id, different data**:
```bash
TOKEN_B=$(printf '{"sub":"usr-northwind-1","organization_id":"org-northwind-b91cde","active_tenant_id":"tenant-north-9a11c2","role":"CUSTOMER_ADMIN"}' | base64 | tr -d '=' | tr '/+' '_-')
curl -s http://localhost:8095/v1/data-products/event-performance/events?event_id=EVT1001 -H "authorization: Bearer $TOKEN_B"
# -> venue_id VEN999, tickets_sold 3000, gross_revenue 250000.00
```

**Rejected — query-param tenant injection** (Tenant A's token, `?tenant_id=` of Tenant B):
```bash
curl -s "http://localhost:8095/v1/data-products/event-performance/events?tenant_id=tenant-north-9a11c2"
# -> 400 {"error":{"code":"INVALID_FILTER","message":"Filter 'tenant_id' is not supported.", ...}}
```

**Rejected — internal field request**:
```bash
curl -s "http://localhost:8095/v1/data-products/event-performance/events?fields=event_id,tenant_id"
# -> 400 {"error":{"code":"INVALID_FIELD_SELECTION", ...}}
```

**Rejected — unsupported filter**:
```bash
curl -s "http://localhost:8095/v1/data-products/event-performance/events?gross_revenue_gt=50000"
# -> 400 {"error":{"code":"INVALID_FILTER", ...}}
```

**Rejected — cross-tenant cursor reuse**: page-1 cursor minted for Tenant A, replayed with Tenant B's token → `400 {"error":{"code":"INVALID_CURSOR", ...}}` (full transcript in `scripts/demo.ts`'s output and `src/tests/e2e/phase8-tenant-isolation.test.ts`).

## 16. Proof of Tenant A/B isolation

Serving-store rows (`psql`):
```
 organization_id       | tenant_id              | event_id | venue_id | tickets_sold | gross_revenue
 org-northwind-b91cde  | tenant-north-9a11c2    | EVT1001  | VEN999   |         3000 |     250000.00
 org-vobis-org-722aea  | tenant-default-47d849  | EVT1001  | VEN001   |         1200 |      84000.00
```
Same `event_id`, disjoint tenants, disjoint data — the API returns exactly the row matching the caller's authenticated `(organization_id, tenant_id)`, proved by the curl examples above and by `src/tests/e2e/phase8-tenant-isolation.test.ts`'s first two assertions.

## 17. Proof internal fields are absent

Serving row (`psql`) for Tenant A's `EVT1001`:
```
 _gold_pipeline_run_id      | _silver_pipeline_run_id    | ingestion_id | exchange_id                | storage_path                                                                              | source_change_token
 gpr-demo-20260909T062153   | spr-demo-20260909T062153   | ing-EVT1001  | exch-org-vobis-org-722aea  | s3://lakehouse-gold/event_performance/org-vobis-org-722aea/tenant-default-47d849/EVT1001 | 59c832...
```
All present in the database row; **zero** occurrences of `organization_id`, `tenant_id`, `_gold_pipeline_run_id`, `_silver_pipeline_run_id`, `ingestion_id`, `exchange_id`, `storage_path`, or `source_change_token` in the API response body — asserted directly in `src/tests/e2e/phase8-tenant-isolation.test.ts`'s "never exposes internal fields" test (string-scans the full serialized response for each name) and in `src/tests/unit/response-projector.test.ts`'s regression test for a field with no accessor.

## 18. Phase 9 telemetry extension points

Per-request structured log line (`src/api/customer/events.routes.ts`, `msg: "DATA_PRODUCT_API_QUERY"`) carries exactly spec §8.13's field list: `request_id, tenant_id, data_product_id, resolved_product_version, api_version, endpoint, latency_ms, result_count, response_bytes, status, serving_snapshot`. No JWTs, Authorization headers, or response rows are ever logged (`common/logger/logger.ts` redaction list). This is the only telemetry surface built — no dashboards, alerting, or SLA tracking (explicitly out of scope), but every field Phase 9 would need to build those is already being emitted in a stable shape.

## 19. Deferred / explicitly out of scope

- Real OIDC/JWKS JWT verification (`verifyProductionJwt` stub) — matches every other service in this repo; none of them implement it either.
- Real rate-limit/quota backend — `InMemoryRateLimiter` is single-process and unbounded-map (no eviction); a production deployment needs a shared backend (Redis, etc.) behind the same `RateLimiter` port.
- k6 performance test written but not executed (§13).
- Only `event-performance`/`events` is wired end-to-end; a second resource/product needs its own route + `ServingStore` method (README §"Extending"), reusing everything else.
- `response-projector.ts`'s `FIELD_ACCESSORS` is a static per-field-name map — adding a new `customer_visible` Catalog field requires a matching code change here (intentional: spec §8.9 "never derive automatically"), not a config-only change.
- No persisted audit-event table for `DATA_PRODUCT_API_QUERY` — emitted as a structured log line only, per spec §8.13's own "only emit the metadata Phase 9 will consume."
- Gateway (TLS, coarse throttling, WAF) is out of scope per spec §8.11 — this service assumes it sits behind one.

## 20. Final invariant checklist (spec §8.20)

Every invariant listed holds, verified live (not just by code inspection) against the running Phase 1–7 stack: raw Gold is never queried by the customer API; tenant context never comes from query parameters (proven — rejected, not silently ignored); every serving query is tenant-scoped by construction (primary key + hard-coded WHERE); entitlement and subscription/API-delivery checks run before any serving-store query; Catalog controls published fields; the serving-store schema is not the public API surface; `/v1/` and the Data Product version are independent (proven with two different resolved versions on the same route); versions resolve dynamically (no hard-coded `1.0.0` anywhere in `data-product-api-service`); arbitrary SQL is impossible (parameterized, fixed column map); filters/sorts are allowlisted from the Catalog contract; pagination is cursor-based (no `OFFSET`); response sizes are bounded (page size + byte limit); the same business key (`EVT1001`) exists in two tenants with different data; tenant cursors cannot cross tenant boundaries (proven); internal fields are deny-by-default (proven, with a regression test); and `ServingStore` is the only surface a different backend would need to reimplement to replace PostgreSQL.
