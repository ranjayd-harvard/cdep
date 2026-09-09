# Queue-based pipeline trigger, gated behind a demo-fixture flag

Status as of 2026-09-07: **implemented and live-verified end-to-end** against
a real running stack (real Postgres, real MinIO, real data-lakehouse and
data-publication-service containers) — a queued job was observed
transitioning `PENDING → INGEST → BRONZE_TO_SILVER → SILVER_TO_GOLD →
PUBLISH → SUCCEEDED`, producing a real OUTBOUND exchange with real
Gold-derived Parquet content, downloadable via a real signed URL. See
[`../data-exchange-service/TEST-DataProduct-onboarding.MD`](../data-exchange-service/TEST-DataProduct-onboarding.MD)
for the full worked example (a brand-new test Data Product onboarded from
scratch) this was verified against.

That first live run also surfaced and fixed one real bug:
`triggerSilverToGold` (`data-exchange-service/src/pipeline-worker/lakehouse-client.ts`)
was passing the job's *Bronze* `data_product_id` as `product_id`, but that
parameter means the *Gold* product id — the fix is to omit it entirely and
let data-lakehouse's own route resolve the Gold product(s) from the Bronze
registration's `gold_products` list via `silver_run_id` (see that file's
updated comment, and the "Troubleshooting" section of
`TEST-DataProduct-onboarding.MD`).

Kept here as the design record for this feature; see
[`exchange-service-integration.md`](exchange-service-integration.md) for the
narrative writeup of how it fits into the wider cdep ↔ data-exchange-service
integration.

## Context

Every completed upload used to synchronously call `publishFixture`
(`src/services/exchange-api/exchange-api-upload-service.ts` →
`src/lib/exchange-service/client.ts` → data-exchange-service's
`/internal/v1/publications`, `data-exchange-service/src/modules/publications/publication.service.ts`),
which fabricates a small hardcoded CSV/JSON fixture and creates an OUTBOUND
exchange row from it — a stand-in built before any real transform pipeline
existed.

That pipeline now exists for real: `data-lakehouse` (Bronze→Silver→Gold) and
`data-publication-service` (Gold→real OUTBOUND exchange, via the newer
`/internal/v1/outbound-publications` endpoint,
`data-exchange-service/src/modules/outbound-publications/`). Both are fully
built and already used manually from `/admin/lakehouse/pipelines`
(`src/app/admin/lakehouse/actions.ts`), via
`src/lib/lakehouse-service/client.ts` and `src/lib/publication-service/client.ts`.
Neither was wired into the upload path.

Decision from discussion with the user:
- Do **not** auto-trigger the real pipeline synchronously on every upload —
  the backend (data-exchange-service) should own scheduling/triggering, via
  a durable job queue.
- Keep `publishFixture` available as an intentional demo/testing convenience,
  toggled by a flag — default ON (preserves prior behavior), so nothing
  breaks for existing demo setups.
- When the flag is OFF, an upload enqueues a pipeline job instead of calling
  the fixture endpoint; a worker inside data-exchange-service polls and runs
  the real chain (ingest → bronze→silver → silver→gold → publish) using the
  same HTTP endpoints the admin page already calls manually.

This only applies to `ExchangeApiUploadService` (the `EXCHANGE_SERVICE_URL`-backed
path). The legacy Mongo-backed `MongoUploadService` has no real exchange
records or lakehouse integration point at all, so it keeps faking output
unconditionally — out of scope here.

## 1. New table: `exchange.pipeline_jobs`

`data-exchange-service/migrations/009_pipeline_jobs.sql`, matching the style
of `004_exchanges.sql` / `006_exchange_events.sql` (`exchange.` schema,
`VARCHAR(64)` app-generated PKs, `CHECK` constraints, `created_at`/`updated_at`,
RLS enabled but not forced):

```sql
CREATE TABLE exchange.pipeline_jobs (
    job_id VARCHAR(64) PRIMARY KEY,

    organization_id      VARCHAR(64) NOT NULL REFERENCES exchange.organizations (organization_id),
    tenant_id             VARCHAR(64) NOT NULL REFERENCES exchange.tenants (tenant_id),
    data_product_id       VARCHAR(64) NOT NULL REFERENCES exchange.data_products (data_product_id),
    source_exchange_id    VARCHAR(64) NOT NULL REFERENCES exchange.exchanges (exchange_id),
    outbound_exchange_id  VARCHAR(64) REFERENCES exchange.exchanges (exchange_id),

    status         VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    current_stage  VARCHAR(32),
    attempts       INT NOT NULL DEFAULT 0,
    error_code     VARCHAR(64),
    error_message  TEXT,

    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pipeline_jobs_status_chk CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT pipeline_jobs_stage_chk CHECK (
        current_stage IS NULL OR current_stage IN ('INGEST', 'BRONZE_TO_SILVER', 'SILVER_TO_GOLD', 'PUBLISH')
    )
);

CREATE INDEX pipeline_jobs_status_idx ON exchange.pipeline_jobs (status, created_at);
CREATE INDEX pipeline_jobs_org_tenant_idx ON exchange.pipeline_jobs (organization_id, tenant_id);

ALTER TABLE exchange.pipeline_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipeline_jobs_tenant_isolation ON exchange.pipeline_jobs
    USING (
        organization_id = current_setting('app.organization_id', true)
        AND tenant_id = current_setting('app.tenant_id', true)
    );
```

Single-attempt semantics for v1 (no auto-retry loop) — `attempts` is tracked
for future use but a FAILED job just sits there for manual inspection; not
building a retry/backoff mechanism now.

Added `pipelineJob: "pj"` to `ID_PREFIXES`
(`data-exchange-service/src/config/constants.ts`) and
`generatePipelineJobId` to
`data-exchange-service/src/common/ids/id-generator.ts`.

## 2. data-exchange-service: `pipeline-jobs` module (enqueue + read)

`data-exchange-service/src/modules/pipeline-jobs/`, mirroring the
`outbound-publications` module's shape (`outbound-publication.routes.ts`,
`.service.ts`, `.schemas.ts`):

- `pipeline-job.schemas.ts` — `createPipelineJobSchema` (`organizationId`,
  `tenantId`, `dataProductId`, `exchangeId`).
- `pipeline-job.repository.ts` — `createPipelineJob`, `claimNextPendingJob`
  (single-row `SELECT ... FOR UPDATE SKIP LOCKED` on `status = 'PENDING'`,
  ordered by `created_at`, atomically flipping it to `RUNNING` in the same
  statement), `updatePipelineJobStage`, `markPipelineJobSucceeded`,
  `markPipelineJobFailed`.
- `pipeline-job.service.ts` — `enqueuePipelineJob(body)`: validates tenant +
  ACTIVE data product exist (same shape as `publication.service.ts`'s own
  checks), inserts a `PENDING` row, returns `{ jobId, status: "PENDING" }`.
- `pipeline-job.routes.ts` — `POST /internal/v1/pipeline-jobs`
  (`requireInternalApiKey`, same as `outbound-publication.routes.ts`).
  No customer-facing read endpoint yet — visibility (e.g. a future admin
  "Pipeline Jobs" list) is a deferred follow-up, not built now.

Registered `pipelineJobRoutes` in `data-exchange-service/src/app.ts` alongside
the other `app.register(...)` calls.

## 3. data-exchange-service: outbound HTTP clients + worker

data-exchange-service previously only *received* calls (from
data-publication-service); it had no outbound clients toward data-lakehouse
or data-publication-service. Added minimal ones, mirroring
`src/lib/lakehouse-service/client.ts` / `src/lib/publication-service/client.ts`
(same fetch-wrapper shape, `x-internal-api-key` header, defensive non-JSON-error
parsing) but scoped to just what the worker needs:

- `data-exchange-service/src/pipeline-worker/lakehouse-client.ts`:
  `triggerIngestion(exchangeId)`, `triggerBronzeToSilver(ingestionId)`,
  `triggerSilverToGold(silverRunId, productId)` (passing `productId` makes
  the lakehouse route return a single-element array — confirmed at
  `data-lakehouse/src/lakehouse/api/routes.py`'s `trigger_silver_to_gold`).
- `data-exchange-service/src/pipeline-worker/publication-client.ts`:
  `triggerPublish(pipelineRunId)`.
- `data-exchange-service/src/pipeline-worker/pipeline-worker.service.ts`:
  `processNextPipelineJob()` — claims one job, then runs the chain,
  updating `current_stage` before each call and checking each outcome's
  `status` against the real enums (confirmed in the Python source):
  - ingest/bronze-to-silver/silver-to-gold: success = `COMPLETED` or
    `SKIPPED_DUPLICATE`, failure = `FAILED`
    (`data-lakehouse/src/lakehouse/ingestion/status.py`,
    `.../pipelines/pipeline_status.py`)
  - publish: success = `READY` or `SKIPPED_DUPLICATE`, failure = `FAILED`/`EXPIRED`
    (`data-publication-service/src/publication/models/publication.py`)
  On the first failing stage: `markPipelineJobFailed(jobId, stage, errorCode, errorMessage)`
  and stop. On success of `triggerPublish`: stores its `outbound_exchange_id`
  and calls `markPipelineJobSucceeded`.
- `data-exchange-service/src/pipeline-worker/worker-loop.ts`: `setInterval`
  poll loop, guarded by an in-flight flag, started from `server.ts` right
  after `app.listen` and stopped on `SIGTERM`/`SIGINT`.
- New env vars in `data-exchange-service/src/config/env.ts` (all optional):
  `LAKEHOUSE_SERVICE_URL`, `LAKEHOUSE_SERVICE_INTERNAL_API_KEY`,
  `PUBLICATION_SERVICE_URL`, `PUBLICATION_SERVICE_INTERNAL_API_KEY`,
  `PIPELINE_WORKER_POLL_INTERVAL_MS` (default `15000`).
  The worker only starts when both `LAKEHOUSE_SERVICE_URL` and
  `PUBLICATION_SERVICE_URL` are set (same opt-in/non-breaking pattern used
  throughout this codebase for optional integrations). If unset, enqueued
  jobs simply accumulate as `PENDING` — visible via direct DB inspection,
  non-fatal.

## 4. cdep (Next.js app): the demo flag and the branch point

- `src/config/env.ts`: `demoFixturePublishEnabled`
  (`process.env.DEMO_FIXTURE_PUBLISH_ENABLED !== "false"`, default `true`,
  matching the existing `useMockServices` pattern — preserves prior behavior
  for anyone who doesn't set the var).
- `src/lib/exchange-service/client.ts`: `enqueuePipelineJob(input: { organizationId,
  tenantId, dataProductId, exchangeId })`, posting to
  `/internal/v1/pipeline-jobs` with `internal: true`, same shape as
  `publishFixture`.
- `src/services/exchange-api/exchange-api-upload-service.ts`:
  `publishProcessedOutput` now takes the INBOUND `exchangeId` and branches on
  `env.demoFixturePublishEnabled`: `true` calls `publishFixture` exactly as
  before; `false` calls `enqueuePipelineJob` instead. Same best-effort
  try/catch-and-log as before — a failure to enqueue must never fail the
  upload itself.

## Verification

1. `cd data-exchange-service && npm run migrate` — confirm `009_pipeline_jobs.sql`
   applies cleanly against the running Postgres container.
2. With `DEMO_FIXTURE_PUBLISH_ENABLED` unset (default true): upload a file
   through the portal exactly as before, confirm the Exchanges page still
   shows an immediate INBOUND + OUTBOUND pair (no behavior change).
3. Set `DEMO_FIXTURE_PUBLISH_ENABLED=false`, restart the app, upload again:
   confirm no OUTBOUND row appears immediately, and a new row exists in
   `exchange.pipeline_jobs` with `status = 'PENDING'`.
4. With `LAKEHOUSE_SERVICE_URL`/`PUBLICATION_SERVICE_URL` configured and
   data-lakehouse/data-publication-service running: confirm the worker picks
   the job up within one poll interval, transitions it through
   `INGEST → BRONZE_TO_SILVER → SILVER_TO_GOLD → PUBLISH`, ends `SUCCEEDED`,
   and a real OUTBOUND exchange (with a real `outbound_exchange_id`, real
   record count, real Gold-derived content) now appears on the Exchanges
   page for that upload.
5. Stop data-lakehouse (or point `LAKEHOUSE_SERVICE_URL` at a bad port),
   upload again, confirm the job ends `FAILED` with `current_stage = 'INGEST'`
   and a populated `error_message`, and that the upload response itself
   still reports success (enqueue failures/pipeline failures must never
   surface as an upload failure to the customer).

## Admin UI: `/admin/lakehouse/queue` (added after the section below was written)

The two items this section originally deferred — an admin list of
`pipeline_jobs` and a manual re-enqueue action — are now built as the
"Pipeline Queue" tab, so it's no longer accurate to call them out-of-scope:

- `data-exchange-service`: `GET /internal/v1/pipeline-jobs` (list,
  optionally filtered by `status`) and `POST
  /internal/v1/pipeline-jobs/:jobId/run` (`pipeline-job.routes.ts` /
  `.service.ts`). The run endpoint atomically (re)claims a job that isn't
  currently `RUNNING` — `PENDING` (run now instead of waiting for the next
  poll tick), `FAILED`, or `SUCCEEDED` (re-enqueue) — via
  `pipeline-job.repository.ts`'s `requeueAndClaimJob`, then runs the same
  chain the poll loop does (`pipeline-worker.service.ts`'s `runClaimedJob`,
  factored out of `processNextPipelineJob` so both share it). Still
  single-attempt in the sense that nothing retries automatically; this is
  the manual trigger the "no retry/backoff" bullet below anticipated.
- cdep: `services.pipelineJobAdmin` (`src/services/pipeline-job-admin/`),
  wired the same opt-in way as `lakehouseAdmin`/`publicationAdmin` — gated
  on `EXCHANGE_SERVICE_URL` alone (listing/running jobs only needs
  data-exchange-service itself; the chain still needs
  `LAKEHOUSE_SERVICE_URL`/`PUBLICATION_SERVICE_URL` to actually succeed,
  same as the poll loop). UI at `src/app/admin/lakehouse/queue/`.

## Deferred / explicitly out of scope

- No automatic retry/backoff for `FAILED` jobs — still single-attempt; the
  admin "Re-enqueue" action above is the manual trigger for it.
- Onboarding a genuinely *new* Bronze/Gold data product still requires
  several manual steps in `data-lakehouse`/`data-publication-service`
  (contracts, registry wiring, DB seed rows, container restarts) — see
  `TEST-DataProduct-onboarding.MD` for the full runbook. Nothing here
  automates that onboarding.
