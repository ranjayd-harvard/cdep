# scheduling-service

Phase 7 — **Scheduling & Delivery Policy Engine** for the CDEP platform.

## Purpose

This service answers one question:

```
Should a subscribed Data Product be published for this tenant now?
```

It decides *when* a publication is due and *whether* it's currently eligible, then issues a
trusted `PublicationRequest` to `data-publication-service`. It never generates the publication
artifact itself.

```
Catalog Service        = what Data Products/versions exist, their lifecycle status
Entitlement Service     = may this org/tenant access this Data Product
Subscription Service    = how this org/tenant wants to consume it (version policy, delivery,
                           schedule)
Scheduling Service       = WHEN publication should happen + is it currently eligible (this service)
Publication Service     = safely creates the customer-facing artifact
Exchange Service        = outbound exchange lifecycle, customer download
```

Scheduling-service owns none of those other domains. It persists only an operational scheduling
*projection* of subscription configuration (refreshed from Subscription Service on a reconcile
loop) plus its own execution/retry/dead-letter history — never a second copy of Data Product,
entitlement, or subscription state.

## Architecture

```
src/
  domain/            Schedule strategies (DAILY/WEEKLY/CRON/ON_DEMAND), timezone/DST engine,
                      execution-key, retry/backoff, missed-run policy, lifecycle eligibility —
                      pure functions, no I/O.
  ports/              Interfaces for Catalog/Subscription/Entitlement/Publication clients,
                      Clock, LeaderElector.
  infrastructure/     HTTP client implementations of those ports, Postgres repositories,
                      Postgres-advisory-lock leader election, the scan-loop timer.
  application/        Orchestration: reconciliation, due-schedule scanning, execution running
                      (claim + dispatch, doubles as the retry coordinator), manual trigger,
                      dead-letter management.
  api/                Fastify routes: /internal/scheduler/* (operator) and
                      /v1/subscriptions/{id}/{schedule-status,executions,publications}
                      (customer-facing).
  container.ts        Composition root — the one place concrete implementations are wired to
                      the ports above.
```

## Correctness guarantees

- **Idempotency**: every scheduled occurrence has a deterministic `execution_key`
  (`subscriptionId|scheduledFor|reason`) under a unique Postgres constraint. Manual/on-demand
  triggers use a client-supplied (or freshly generated) idempotency key instead. The same key is
  forwarded to Publication Service as `external_idempotency_key`, so a lost-response retry can
  never create a second artifact.
- **Duplicate prevention is layered**: Postgres advisory-lock leadership (optimization) →
  `FOR UPDATE SKIP LOCKED` atomic claiming (optimization) → `execution_key` UNIQUE constraint
  (correctness) → Publication Service's own idempotency check (correctness). Layers 3 and 4 hold
  even if 1 and 2 fail.
- **Revalidation, not caching**: subscription status, entitlement, Catalog version/lifecycle, and
  delivery capability are all re-fetched immediately before every dispatch attempt — never trusted
  from the scheduler's own projection or a previous attempt.
- **DST-safe**: DAILY/WEEKLY next-run calculation resolves local wall-clock time via a two-pass
  offset-guess-and-correct against each IANA zone (see `domain/timezone.ts`), not `lastRun + 24h`.
  Spring-forward gaps execute at the next valid local instant; fall-back overlaps execute exactly
  once (the earlier occurrence).

## Running locally

```bash
docker compose up -d postgres
npm install
npm run migrate
npm run dev            # tsx watch, port 8094 by default
```

Requires `CATALOG_SERVICE_URL`, `SUBSCRIPTION_SERVICE_URL`, and `PUBLICATION_SERVICE_URL` (see
`.env.example`) pointing at running instances of those services for anything beyond health checks
to work.

```bash
npm run demo            # walks the Vobis Org / Event Performance scenario end to end
npm test                 # unit + integration + e2e (integration/e2e need the services above)
```

The demo backdates the scheduler's own `next_run_at` rather than waiting on a real DAILY/WEEKLY
clock — see `scripts/demo.ts` step 5.

## What "SUCCEEDED" actually requires

A scheduled or on-demand execution only reaches `SUCCEEDED` if Publication Service can find a
completed Bronze→Silver→Gold pipeline run for the exact (organization, tenant, data product,
resolved version) scope in `data-lakehouse`. Without one it correctly returns
`GOLD_READY_NOT_FOUND`, which this service classifies as a transient, retriable failure — you'll
see executions land in `RETRY_WAIT` with a full audit trail rather than an ambiguous error. This
is expected in a local environment that hasn't run the earlier pipeline phases for that scope.

## Modest additive changes made to upstream services

Building this against the already-implemented Phase 4–6 services required a few small,
backward-compatible extensions (no existing behavior changed):

- **subscription-service**: `frequency` gained a `CRON` value; `delivery` gained optional
  `day_of_week`/`cron_expression` fields (stored in the previously-unused `configuration` JSONB
  column — no new columns); `/internal/v1/subscriptions/delivery-candidates` gained pagination.
- **data-publication-service**: `POST /internal/v1/publications` now also accepts an
  `(organization_id, tenant_id, data_product_id, product_version)` scope as an alternative to
  `pipeline_run_id` (resolving the latest completed Gold run for that scope), plus an optional
  `external_idempotency_key` for cross-service retry-safety.
