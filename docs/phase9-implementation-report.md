# Phase 9 — Observability, SLA & Operational Control: Implementation Report

Status: 9.1–9.8 implemented for real (schema, ingestion + adapters +
reconciliation, correlation + timeline + diagnostics, metrics, SLA engine,
health scoring, alerting/incidents, full internal + customer-safe API
surface), with real Postgres migrations and tests throughout. 9.9
(telemetry) intentionally kept light per the agreed scope (structured logs
+ correlation IDs + a hand-rolled `/metrics` counters endpoint, no
OpenTelemetry SDK). 9.10 (the three demonstration scenarios) implemented as
a repeatable e2e test suite plus a runnable `npm run seed-demo` script.

Verified against **actually running Phase 1–8 services on the dev
machine** during development, not just fixtures — this surfaced and fixed
four real bugs no unit test would have caught (§8 below).

## 1. Component created

`data-platform-observability-service` — Node 20, TypeScript, Fastify, `pg`
(raw SQL, no ORM), matching `scheduling-service`'s ports+infrastructure+
domain+application+api layered shape (the closest existing analog: it also
calls out to multiple siblings without owning their domains). Fully
independent deployable project — own `package.json`, `Dockerfile`,
`docker-compose.yml` (Postgres `5441`, HTTP `8097`, next free in the
platform's sequential port allocation). No shared package introduced,
matching the repo-wide convention every other service already follows.

## 2. Database migrations (`migrations/001`–`013`)

`operational_executions` (the correlation root, full ID-chain columns) ·
`operational_execution_identifiers` (the join-key index — `(id_type,
id_value)` → `execution_id`, the mechanism that makes correlation O(1)
instead of an 8-nullable-column scan) · `operational_stage_runs` ·
`operational_events` (event_id is the source's own idempotent id — `ON
CONFLICT DO NOTHING` is the entire dedup mechanism) · `operational_metrics`
(deliberately no execution_id/high-cardinality columns) · `sla_definitions`
(append-and-supersede, never `UPDATE`d in place) · `sla_evaluations` ·
`alerts` (`dedup_key UNIQUE`) · `maintenance_windows` · `incidents` +
`incident_alerts` · `service_health` · `reconciliation_runs` · cross-cutting
indexes. All 13 apply cleanly against a fresh Postgres 5441 and re-running
is a no-op (verified).

## 3. Correlation model

`operational_execution_identifiers` is a flat `(id_type, id_value) →
execution_id` index, not 8 nullable FK columns. Resolution: exact match on
any identifier the incoming event carries (a chained field like
`publication_runs.source_pipeline_run_id` hits the same index under a
different original id_type, so "direct" and "chained" matches are one
lookup) → heuristic `(org, tenant, product, version)` scope+time-window
fallback only when nothing matches → create new. Every identifier is also
denormalized directly onto the `operational_executions` row (not just the
index) so a direct read never needs a join.

**Verified live**: ran the service against the actually-running
`data-exchange-service`, `data-lakehouse` (direct Postgres), `data-product-
catalog-service`, `subscription-service`, `scheduling-service`,
`data-publication-service`, and `serving-projection-service` on this dev
machine. Real cross-service correlation worked correctly — e.g. a real
`publication_id` correctly stitched to its real `gold_pipeline_run_id` and
real `outbound_exchange_id` into one execution, entirely via the join-key
index, using data these services had produced independently of this
service's existence.

## 4. Sibling adapters

| Sibling | Mechanism | Notes |
|---|---|---|
| `data-exchange-service` | HTTP poll, `/internal/v1/exchanges?direction=&limit=` | No since/cursor filter — generous limit + dedup + reconciliation is the backstop |
| `data-product-catalog-service` | HTTP poll, public `GET /v1/data-products/:id/versions/:version` | Feeds `catalog-sla-sync` only, not a stage |
| `subscription-service` | HTTP, `GET /internal/v1/subscriptions/:id/delivery-context` | Context enrichment only, no periodic poller |
| `scheduling-service` | HTTP poll, `GET /internal/scheduler/executions?scheduled_from=&scheduled_to=` | The one sibling with a real time-range filter — polls incrementally |
| `data-publication-service` | HTTP poll, `GET /internal/v1/publications?limit=` | No since/cursor filter, same backstop as exchange |
| `data-lakehouse` | **Direct read-only Postgres** (port 5434), `lakehouse.{ingestion_runs,pipeline_runs,quality_results}` | Mirrors the real precedent `data-publication-service` already uses for the same database — confirmed by inspecting its own compose file |
| `serving-projection-service` | HTTP poll, `GET /internal/v1/projection-runs` | Feeds `service_health` only — `projection_runs` has no tenant columns |
| `data-product-api-service` | none | No internal API and no events emitted today — `API_DELIVERY` correlation is heuristic-only, `api_request_id` stays `NULL` |

Two auth mismatches were caught and fixed by testing against the real
services rather than mocks: `scheduling-service`'s `requireInternalAuth`
requires `x-actor-type/x-actor-id/x-actor-role` headers once a key is
present (the exchange/publication/catalog services don't require this) —
the scheduling HTTP client was missing them; and
`serving-projection-service`'s actual configured key is
`dev-internal-key-change-me-serving`, not the platform's usual
`dev-internal-key-change-me`.

## 5. SLA, health, and alerting

- **Technical SLA**: per-stage target duration (Phase-9-owned defaults,
  seeded into `sla_definitions` as `STAGE_TARGET` rows on first use, since
  catalog declares nothing per-stage).
- **Business SLA**: catalog's declared `deliveryDeadlineExpression`, cached
  via `catalog-sla-sync.service.ts` (append-and-supersede). Supports two
  concrete expression forms — `T+<n><unit>` and `daily HH:MM <tz>` — since
  no grammar for this field exists anywhere else in the repo (confirmed:
  unvalidated free-text, no example value in any of the 4 example contract
  YAMLs); anything else evaluates to `NOT_APPLICABLE`, never crashes.
- **Health**: config-driven weighted score (`HEALTH_WEIGHT_*` env vars,
  validated to sum to 1.0 at boot), component breakdown always returned
  alongside the verdict — never a black box.
- **Alerts**: one pure predicate per rule, deterministic `dedup_key`
  (DB-unique) so a repeated fire re-opens/updates rather than duplicating,
  maintenance-window + per-alert suppression, lightweight incident
  correlation (CRITICAL alerts in the same scope+window group into one
  incident), and auto-resolution: a later successful execution in the same
  `(tenant, product, version)` scope resolves prior executions' still-open
  alerts — the row is never deleted, only its state transitions, so
  history survives recovery.

## 6. APIs

Internal (`requireInternalAuth`, actor-context variant so ack/resolve/
suppress/maintenance-window actions carry an audit trail): `POST
/v1/events`, `GET /internal/v1/operations/data-products/:id/health`,
`.../executions`, `GET /internal/v1/operations/executions/:id[/timeline|
/metrics]`, `GET /internal/v1/operations/{alerts,incidents,sla,metrics}` +
ack/resolve/suppress + maintenance-window CRUD. Customer-safe
(`requireAuth`): `GET /v1/customer/data-products/:id/status` — tenant
identity always from the authenticated context, never a client-supplied
id; every failure mode collapses to one 404
(`PRODUCT_STATUS_NOT_FOUND`), matching `data-product-api-service`'s
Phase 8 anti-enumeration discipline. Ops: `/health/{live,ready}`,
`/metrics`. OpenAPI: auto-generated via `@fastify/swagger` (served at
`/docs`), exportable via `npm run export-openapi` (19 paths, verified).

## 7. Testing

**83/83 tests pass** across 19 files:

- Unit (13 files, 59 tests): correlation decision, execution-state
  derivation, failed-stage/stuck-run detection, retry recommendation,
  timeline, SLA expression parsing + evaluator, health scoring, alert
  rules/dedup-key/suppression/incident-correlator.
- Integration (5 files, 20 tests): event-ingestion idempotency
  (duplicate/out-of-order events), the full cross-service ID chain +
  heuristic fallback + distinct-execution-on-completed-prior, technical +
  business SLA (PASS/FAIL/NOT_APPLICABLE), alert lifecycle (open/no-
  duplicate-on-repeat/auto-resolve-on-recovery/suppression-via-maintenance-
  window/incident-correlation), tenant isolation (internal list + alerts +
  customer-safe route, including a stranger tenant with no data getting the
  same 404 as an unentitled one).
- E2E (1 file, 4 tests): the three required demonstration scenarios (spec
  §38–40) plus the tenant-isolation demonstration (§41), as deterministic
  assertions.

`npm run build` (production TS compile) and `npx eslint .` both pass clean
(0 errors; 6 pre-existing `@typescript-eslint/no-explicit-any` warnings in
row-mapping boundary code, judged acceptable).

## 8. Real bugs found and fixed via live-service testing

Running the service against the actually-running sibling stack (not just
fixtures) surfaced four genuine bugs unit tests alone would have missed:

1. **Identifier backfill gap** — correlation wrote every identifier into
   the join-key index but never denormalized them onto
   `operational_executions` itself, so `inbound_exchange_id`/
   `publication_id`/etc. stayed empty on the row despite being correctly
   indexed. Fixed in `correlation.service.ts`.
2. **JSONB key-order comparison bug** — Postgres JSONB does not preserve
   original key insertion order; `sla-definition.repository.ts`'s
   "has the declared SLA changed?" check used raw `JSON.stringify`
   equality, which false-positived as "changed" whenever the DB's
   canonicalized key order differed from a freshly-constructed JS object's
   — silently duplicating `sla_definitions` rows on every sync. Fixed with
   an order-independent canonical-JSON comparison.
3. **Business SLA reference-time anchoring bug** — falling back to
   evaluation wall-clock `now()` when `execution.startedAt` was unknown
   anchored a `daily HH:MM` deadline to whichever moment the evaluator
   happened to run, not the execution's actual timeline. Fixed by falling
   back to the earliest timestamp actually on record in the stage-run data
   before falling back to wall-clock time.
4. **Incident linking never persisted** — `alert-evaluation.service.ts`
   called `incident.repository.ts`'s `linkAlert` (which only inserts into
   the `incident_alerts` join table) but never
   `alert.repository.ts`'s `linkAlertToIncident` (which sets
   `alerts.incident_id`), so every subsequent alert in the same scope+
   window found no prior incident to join and created a new one — three
   incidents for two related alerts instead of one. Fixed by calling both.

## 9. Demonstration

`npm run seed-demo` reproduces, against a live running instance:

- Scenario (a): full on-time execution → `overall_status=SUCCEEDED`,
  `technical_sla_status=PASS`, `business_sla_status=PASS`,
  `health_status=HEALTHY`, zero alerts.
- Scenario (b): delayed publication → `business_sla_status=FAIL`, an
  `OPEN` `BUSINESS_SLA_BREACHED` alert with a correctly-computed breach
  duration, health no longer `HEALTHY`.
- Scenario (c): the next on-time execution → `PASS`/`HEALTHY` again, and
  scenario (b)'s alert transitions to `RESOLVED` — same row, history
  intact, never deleted.
- Tenant isolation: a second tenant's data never appears in the first
  tenant's queries, including the customer-safe route.

All four outcomes were confirmed against the actual seeded Postgres state
(not just the e2e test's in-process assertions).

## 10. Known limitations / flagged reductions

1. Exchange/publication internal HTTP has no since/cursor filter — handled
   with generous-limit polling + reconciliation, not a since-filtered
   query.
2. No `deliveryDeadlineExpression` grammar exists elsewhere in the repo —
   two concrete forms supported, everything else `NOT_APPLICABLE`.
3. `data-product-api-service` emits no events/metrics today — `API_DELIVERY`
   correlation is heuristic-only.
4. `serving-projection-service`'s `projection_runs` has no tenant columns —
   feeds `service_health` only.
5. 9.9 telemetry is intentionally light (no OpenTelemetry SDK).
6. A stage first observed already terminal (poll caught it after the fact)
   has no known `started_at` — technical SLA reports `UNKNOWN` for that
   stage rather than fabricating a start time; this is honest behavior
   that resolves itself once continuous polling has run long enough to
   catch a stage's `RUNNING` transition.
7. Aggregate (non-execution-scoped) alert rules — `API_AVAILABILITY_BELOW_
   THRESHOLD` and `NO_DATA_RECEIVED` — are implemented and unit-tested in
   `domain/alerting/alert-rules.ts` but not yet wired into a periodic
   window evaluator (they need a scheduled tick, not a per-event one).
8. No dedicated contract-test suite per sibling HTTP client (subscription-
   service's own fixture-server pattern) — superseded in this pass by
   direct verification against the real running siblings, which is
   stronger evidence but not a repeatable CI artifact.

## 11. Recommended next steps for Phase 10

- Wire the two aggregate alert rules into a periodic evaluator once a
  Phase 10 versioning model clarifies what "the current window" means per
  product version.
- Add a `since`/cursor parameter to `data-exchange-service`'s and
  `data-publication-service`'s internal list endpoints (the tiny-additive-
  endpoint precedent Phase 8 already set for `subscription-service`'s
  `/resolve` route) to make polling airtight rather than reconciliation-
  backstopped.
- Once `data-product-api-service` gains any request-level
  instrumentation, add a matching adapter/normalizer so `API_DELIVERY`
  correlation becomes exact rather than heuristic.
- `sla_definitions`/`operational_executions` already carry `product_version`
  as a plain column (never assumed to be singular) — Phase 10's multi-
  version views should need no schema change here, only new queries.
