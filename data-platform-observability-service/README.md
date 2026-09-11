# data-platform-observability-service

Phase 9 — **Observability, SLA & Operational Control** for the CDEP platform.

## Purpose

This service answers:

```
Did the customer's data arrive, on time, at the promised quality and availability —
and if not, exactly where and why did it fail?
```

It observes and correlates Phases 1-8's independently-owned workflows (exchange, lakehouse,
publication, catalog, subscription, scheduling, API delivery, serving-projection) into one
operational read model, then layers technical/business SLA evaluation, health scoring, and
alerting on top.

```
Exchange Service        = inbound/outbound exchange lifecycle
Lakehouse               = Bronze/Silver/Gold pipeline runs, ingestion, quality results
Publication Service     = publication runs, outbound exchange creation
Catalog Service         = Data Product identity, declared SLA
Subscription Service    = subscription/delivery-preference context
Scheduling Service      = scheduled_run_id, subscription_id, scheduling-level outcomes
API Delivery Service    = customer-facing API serving (no events emitted today — see Known Limitations)
Serving Projection      = Gold -> Postgres projection health (ops signal only, no tenant scoping)
Observability Service   = observes/correlates/evaluates all of the above (this service)
```

This service owns **none** of those other domains' workflow execution. It persists only a
normalized operational projection (`operational_executions` + related tables) refreshed via
push (`POST /v1/events`), pull (per-sibling pollers), and a reconciliation loop — never a second
copy of Data Product, entitlement, subscription, or pipeline state, and it never retries a
sibling's workflow itself (see `domain/retry-recommender.ts`: it recommends, the owning service executes).

## Architecture

```
src/
  domain/             Pure logic, no I/O: stage ordering, execution-state derivation,
                      correlation decision, timeline building, failed-stage/stuck-run
                      detection, retry recommendation, SLA expression parsing + evaluation,
                      health scoring, alert rules/dedup/suppression/incident correlation.
  ports/              Interfaces for each sibling client + Clock + LeaderElector.
  infrastructure/
    http/             HTTP client implementations of the sibling ports.
    postgres/         Direct read-only reads against data-lakehouse's own Postgres (the
                      `lakehouse` schema) — the same precedent data-publication-service
                      already uses for the same database.
    persistence/       One repository per table.
    scheduling/        Poll-loop timer + Postgres-advisory-lock leader election (only the
                      write-side reconciliation loop needs leadership; read-only polling is
                      harmless run concurrently).
  application/
    dto/                The normalized event envelope (spec section 7) + zod schema.
    normalizers/        One per sibling that produces stage data — maps that service's real
                      states onto the fixed normalized stage/status vocabulary.
    services/           event-ingestion (the one pipeline both push and pull go through),
                      correlation, metrics-evaluation, sla-evaluation, health-evaluation,
                      alert-evaluation, catalog-sla-sync.
    pollers/            One per pull-adapter, sharing the generic poll-loop.
    reconciliation/     Re-pulls a bounded recent window and replays it through the SAME
                      ingestion pipeline — never a separate write path, never mutates a
                      sibling's own state.
  api/
    internal/           /v1/events (push), /internal/v1/operations/* (executions, health,
                      timeline, metrics, alerts, incidents, sla, maintenance-windows).
    customer/           /v1/customer/data-products/{id}/status — the only customer-safe route.
  modules/            /health/{live,ready}, /metrics (hand-rolled Prometheus counters).
  container.ts        Composition root wiring ports to concrete implementations.
```

## Correlation model

Every execution's chain of independently-generated IDs (`inbound_exchange_id -> ingestion_id ->
silver_pipeline_run_id -> gold_pipeline_run_id -> publication_id -> outbound_exchange_id`) is
stitched together via a flat join-key index (`operational_execution_identifiers`), not 8 nullable
FK columns scanned per event. Resolution order per incoming event:

1. **Exact match** — any identifier the event carries that's already indexed resolves to its
   execution immediately (a chained field like `publication_runs.source_pipeline_run_id` hits the
   same index under a different original id_type, so "direct" and "chained" matches are the same
   lookup).
2. **Heuristic fallback** — only when no explicit ID matches: the most recent still-open
   execution for the same `(organization_id, tenant_id, data_product_id, product_version)` within
   `CORRELATION_WINDOW_MINUTES`, flagged `correlation_confidence=HEURISTIC` for observability of
   the correlator's own accuracy.
3. **Create** — neither matches: a brand-new execution, with `scheduled_run_id`/`subscription_id`
   naturally `NULL` for an ad hoc (non-scheduled) run rather than a special-cased model.

Verified against the real, currently-running sibling services during development (not just
fixtures) — see `docs/` in the repo root or the implementation report for details.

## Running locally

```bash
npm install
docker compose up -d postgres     # or point DATABASE_URL at your own Postgres
npm run migrate
npm run dev
```

Configure the sibling service URLs/keys in `.env` (see `.env.example`) — any sibling left
unconfigured has its poller disabled rather than guessing/fabricating data.

## Testing

```bash
npm test
```

- `src/tests/unit/` — every domain module (correlation, SLA evaluator/expression parser, health
  scoring, alert rules/dedup/suppression/incident-correlator, failed-stage/stuck-run detection,
  retry recommendation, timeline).
- `src/tests/integration/` — event-ingestion idempotency (duplicate/out-of-order events), the
  full cross-service ID chain, technical + business SLA (PASS/FAIL/NOT_APPLICABLE), alert
  lifecycle (open/dedupe/suppress/auto-resolve-on-recovery/incident correlation), tenant
  isolation (internal + customer-safe routes).
- `src/tests/e2e/vobis-demo.test.ts` — the three required demonstration scenarios (spec sections
  38-41) as repeatable assertions: full on-time execution, delayed-publication business-SLA
  breach, and on-time recovery that resolves the prior alert without erasing its history.

## Demonstration

```bash
npm run seed-demo
```

Seeds the same three-scenario narrative (plus a second-tenant isolation fixture) against a
running instance's own database via the real ingestion pipeline. Inspect afterward via:

```
GET /internal/v1/operations/data-products/event-performance/health
GET /internal/v1/operations/data-products/event-performance/executions
GET /internal/v1/operations/alerts
GET /v1/customer/data-products/event-performance/status
```

## Known limitations (see the implementation report for the full list)

- Exchange/publication internal HTTP APIs have no since/cursor filter — polled with a generous
  limit; the reconciliation loop, not the poller alone, is the correctness backstop.
- No `deliveryDeadlineExpression` grammar exists anywhere else in the repo — this service defines
  exactly two concrete forms (`T+<n><unit>`, `daily HH:MM <tz>`); anything else evaluates to
  `NOT_APPLICABLE` rather than crashing.
- `API_DELIVERY` correlation is heuristic-only — `data-product-api-service` emits no events/
  metrics today, so `api_request_id` stays `NULL`.
- `serving-projection-service`'s `projection_runs` carries no tenant columns — it feeds
  `service_health` only, never a per-execution stage.
- 9.9 telemetry is intentionally light: structured logs + correlation IDs + a hand-rolled
  `/metrics` counters endpoint, no OpenTelemetry SDK.
- A stage first observed already in a terminal state (poll caught it after the fact) has no
  known `started_at` — technical SLA reports `UNKNOWN` for that stage rather than fabricating a
  start time; this is honest behavior, not a bug, and resolves itself once continuous polling has
  been running long enough to catch a stage's `RUNNING` transition.
