# data-publication-service

Phase 4 of the Customer Data Exchange Platform: the **Publication Service**.
It closes the loop between the lakehouse's Gold layer and the customer
download experience:

```text
GOLD DATA PRODUCT
      │  GoldReady (pipeline_run_id, org, tenant, product, snapshot)
      ▼
PUBLICATION SERVICE (this repo)
      │  resolve contract → read exact Gold snapshot (tenant-scoped)
      │  → cross-tenant safety assertion → project published schema
      │  → quality gate → export (Parquet/CSV) → SHA-256 checksum
      ▼  internal API (create → upload → complete)
DATA EXCHANGE SERVICE (../data-exchange-service)
      │  creates OUTBOUND exchange, assigns object key, writes manifest,
      │  marks READY, owns expiration + customer entitlement + signed URLs
      ▼
OUTBOUND OBJECT STORAGE (MinIO, owned by data-exchange-service)
      ▼
CUSTOMER PORTAL (../, cdep) → signed download URL → CUSTOMER
```

It is a separate deployable from `data-exchange-service` and
`data-lakehouse` on purpose — see AGENTS.md §2 for the ownership split
(Publication owns projection/export/artifact lifecycle; Exchange owns
outbound storage/entitlement/signed URLs; Lakehouse owns Gold/Iceberg).
The Customer Portal never talks to this service directly (§58) and never
queries `gold.*`/`silver.*`/`bronze.*` or touches lakehouse storage.

## Why PyIceberg + PyArrow, not PySpark

AGENTS.md's original brief calls for PySpark. The actual, already-built
`data-lakehouse` (Phase 2/3) uses PyIceberg + PyArrow directly against a
Postgres-backed Iceberg catalog and MinIO — there is no Spark cluster
anywhere in this stack. Introducing Spark here would mean a second,
inconsistent Iceberg read/write path for the same tables. Per "adapt to
the existing Phase 1-3 implementation, minor changes are acceptable"
(AGENTS.md §71.2), this service matches the lakehouse's actual stack:
PyIceberg for catalog/table access, PyArrow for in-memory projection and
export. Both exporters write a single file per publication, which is the
documented, deliberate tradeoff for local/demo-scale data (§46) — the
artifact model itself supports N files per publication (§47) for a future
large-dataset path.

## Repository layout

```text
config/application.yaml        Static, non-secret config
contracts/products/*.yaml      Publication contracts (customer-facing schema)
sql/*.sql                      publication.* Postgres schema (idempotent DDL)
src/publication/
  config/settings.py           Env-driven Settings (PUBLICATION_* vars)
  models/                      GoldReadyContext, PublicationContract, PublicationStatus, ArtifactResult
  contracts/                   Contract loader + GoldReady-vs-contract validator
  lakehouse/                   Iceberg catalog access, snapshot resolution,
                                TenantScopedGoldReader + cross-tenant assertion
  transformations/             Schema projection, type casting, masking hook
  exporters/                   ParquetExporter, CsvExporter
  quality/                     Publication quality gate (6 rules) + persistence
  exchange/                    ExchangeServiceClient (httpx) + service-auth
  services/publication_service.py   The orchestrator (the whole pipeline above)
  metadata/                    Postgres repository + migrations runner
  notifications/               PublicationReady (logging notifier today)
  observability/               Structured logging + metrics stub
scripts/
  publish_gold_product.py      CLI: GoldReady -> Outbound Exchange
  reconcile_publications.py    Idempotent consistency checker (read-only)
  inspect_publication.py       Dump one publication's full lifecycle as JSON
tests/unit/                    No infra required
tests/integration/             (none checked in yet — this Phase 4 build
                                was verified directly against the live
                                local stack; see "What was verified" below)
```

## Data Exchange Service integration contract

This service is additive to `data-exchange-service` — it does not touch
or replace that service's pre-existing `/internal/v1/publications`
fixture-content simulator (still used by cdep's own upload-triggered demo
publish). It adds:

```text
POST   /internal/v1/outbound-publications
POST   /internal/v1/outbound-publications/{exchangeId}/complete
POST   /internal/v1/outbound-publications/{exchangeId}/fail
GET    /internal/v1/exchanges/{exchangeId}/manifest     (pre-existing, reused)
```

`create` takes the artifact's declared filename/format/size/recordCount/
checksum and returns a signed PUT URL (the Exchange Service assigns the
bucket, object key, exchange ID, and expiration — this service never
picks a storage path). `complete` re-downloads the object, recomputes its
SHA-256 from the real bytes (never trusts an S3 ETag as a checksum — see
AGENTS.md §45), compares it to what was declared at `create` time, and
only then writes `manifest.json` and flips the exchange to `READY`. A
mismatch transitions the exchange straight to `FAILED` and returns
`422 CHECKSUM_MISMATCH`. See
`../data-exchange-service/src/modules/outbound-publications/` for the
implementation and
`../data-exchange-service/src/tests/integration/outbound-gold-publication.test.ts`
for the test coverage (create→upload→complete, idempotent complete,
checksum mismatch, cross-tenant download denial, explicit `/fail`).

Service-to-service auth is the same static `x-internal-api-key` mechanism
`data-lakehouse`'s own `exchange_client=http` path already uses against
this same Exchange Service (`PUBLICATION_EXCHANGE_SERVICE_API_KEY` here
must match that service's `INTERNAL_API_KEY`). See
`src/publication/exchange/auth.py` for the production (AWS/GCP) mapping.

## GoldReady input

`GoldReadyContext` (`src/publication/models/gold_ready.py`) matches the
JSON shape data-lakehouse's `notifications.gold_ready.GoldReady` emits
verbatim. Two ways to supply it (AGENTS.md §37):

```bash
# A. Resolve it from data-lakehouse's own pipeline_runs table by run id
#    (read-only cross-service read -- see gold_metadata_reader.py for why
#    this doesn't require a new lakehouse HTTP endpoint or an event bus).
python scripts/publish_gold_product.py --pipeline-run-id run-gold-001

# B. Or hand it a GoldReady JSON file directly.
python scripts/publish_gold_product.py --gold-ready-file samples/gold-ready.json
```

`--format PARQUET|CSV` overrides the contract's `defaultFormat`.
`--republish` forces a new publication even if one already exists for the
exact same (org, tenant, product, version, gold_snapshot_id, format,
contract_version) tuple — see "Idempotency" below.

## Publication contract

`contracts/products/event-performance.yaml` is the **only** place the
externally-published schema is defined. The physical `gold.event_performance`
table also carries `organization_id`, `tenant_id`, and `_gold_pipeline_run_id`/
`_product_id`/`_product_version`/`_created_at`/`_updated_at` — none of
those reach the customer artifact because `project_published_schema()`
builds the output table from the contract's column list alone (nothing to
turn off, nothing to forget).

## Tenant scoping and cross-tenant safety

`TenantScopedGoldReader` (`src/publication/lakehouse/tenant_scope.py`)
requires `organization_id` + `tenant_id` and pins the scan to an exact
Iceberg snapshot (`table.scan(row_filter=..., snapshot_id=...)`). After
the scan, `assert_cross_tenant_safety()` re-checks every returned row's
org/tenant columns against the trusted values and raises
`CrossTenantSafetyError` (aborting the publication) if anything else shows
up — a defense against a filter-pushdown bug or a future refactor that
loosens the row filter, not just "trust the query planner."

## Quality gate (blocking)

Runs after projection, before the Exchange Service is ever contacted:
`SCHEMA_MATCH`, `TENANT_SCOPE_VALID`, `GRAIN_UNIQUE`, `ARTIFACT_NON_EMPTY`,
`RECORD_COUNT_MATCH`, and (post-export) `ARTIFACT_READABLE`. Every result
is persisted to `publication.publication_quality_results` regardless of
outcome. Any ERROR-severity failure aborts before `CREATING_OUTBOUND_EXCHANGE`
— no READY outbound exchange is ever created from a failed gate.

## Idempotency

Identity key: `organization_id | tenant_id | data_product_id |
product_version | gold_snapshot_id | requested_format | contract_version`.
A second `publish()` call with the same key and an existing `READY` run
returns `SKIPPED_DUPLICATE` with the *original* `publication_id` and
`outbound_exchange_id` — no new outbound file is created. `--republish`
bypasses the lookup and always creates a new publication run (new
`publication_id`, new outbound exchange).

## Local setup

```bash
cp .env.example .env
docker compose up -d postgres          # this service's own control-plane Postgres
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m publication.metadata.migrations
```

Requires a running `data-lakehouse` (Postgres+MinIO with Gold data) and a
running `data-exchange-service` (Postgres+MinIO+API) reachable at the
hosts/ports in `.env` — `platform/start.sh` at the repo root brings up
every sibling service's compose stack in one command (this repo included,
via the same directory-discovery `platform/README.md` documents).

## Commands

```bash
python scripts/publish_gold_product.py --pipeline-run-id run-gold-001 [--format CSV] [--republish]
python scripts/inspect_publication.py pub-...          # full lifecycle as JSON
python scripts/reconcile_publications.py [--stale-minutes 60]   # read-only, idempotent
python -m pytest tests/unit                            # no infra required
```

Or via the `runner` service in `docker-compose.yml` (`make publish
ARGS="--pipeline-run-id run-gold-001"`, `make reconcile`, `make test`).

## What was actually verified (not just implemented)

Run against the real, running local stack (real `data-lakehouse` Postgres/
MinIO with genuine multi-tenant Gold data already in `gold.event_performance`,
real `data-exchange-service` Postgres/MinIO, rebuilt with this repo's new
routes):

1. **Real snapshot-pinned, tenant-scoped Gold read** for `org-vobis-org-722aea`
   / `tenant-default-47d849` (pipeline run `run-01a0751013f6729aaef814af2300cceb`,
   snapshot `9139899140245559563`) — 21 rows, cross-tenant assertion passed.
2. **Schema projection** — downloaded artifact's columns are exactly
   `event_id, venue_id, event_date, tickets_sold, gross_revenue,
   revenue_per_ticket`; `organization_id`/`tenant_id`/`_gold_pipeline_run_id`
   etc. are absent, confirmed by reading the actual downloaded Parquet file.
3. **Quality gate** — all 6 rules persisted and passing in
   `publication.publication_quality_results`.
4. **Parquet export** — round-tripped through `pyarrow.parquet.write_table`
   → `read_table`, checksum `e2f187ee...` recorded and matched.
5. **CSV export** (gzip) — used for the snapshot-consistency test below.
6. **Real Exchange Service handoff** — `POST /internal/v1/outbound-publications`
   → real signed MinIO PUT → `POST .../complete` → real `manifest.json`
   containing the `publication` lineage block (`publicationId`,
   `goldSnapshotId`, `goldPipelineRunId`) → exchange `READY`.
7. **Real signed download** — `POST /v1/downloads/{id}/url` issued a real
   presigned MinIO GET URL; downloading it and opening the file with
   `pyarrow.parquet.read_table` reproduced the exact schema and row count.
8. **Cross-tenant isolation, with two real tenants sharing the same
   physical `gold.event_performance` table** (`org-vobis-org-722aea` and
   `org-acme-live-001`): each published artifact contained only its own
   tenant's rows (21 vs. 15); Tenant A's token got `404` requesting Tenant
   B's exchange detail and download URL, and vice versa.
9. **Idempotency**: re-running `publish_gold_product.py` with the same
   pipeline-run-id/format returned `SKIPPED_DUPLICATE` with the original
   `publication_id`/`outbound_exchange_id`; `--republish` created a
   genuinely new publication and exchange.
10. **Snapshot consistency**: appended a new row to `gold.event_performance`
    for the same tenant (creating a new Iceberg snapshot, 22 rows current),
    then published a `GoldReady` pinned to the *original* snapshot id —
    the resulting artifact still had exactly 21 rows, not 22.
11. **Expiration**: manually expired one exchange's `expires_at`; the next
    download-URL request correctly returned `410 EXCHANGE_EXPIRED` — the
    Publication Service never independently authorizes past this point.
12. **Reconciliation**: `reconcile_publications.py` run against this real
    state correctly reported the one publication whose exchange had
    expired (`PUBLICATION_READY_BUT_EXCHANGE_NOT`) and nothing else.
13. **Failure handling**: the very first live attempt (before the Exchange
    Service container was rebuilt with the new routes) failed cleanly at
    the Exchange Service call with a persisted `FAILED` status and
    `EXCHANGE_SERVICE_ERROR` — Gold was never touched, and the immediately
    following successful run for the same `pipeline_run_id` was not
    blocked by the earlier failure (only `READY` runs count for
    idempotency).
14. **Full lineage traversal** (see below) from a downloaded artifact back
    to the original inbound CSV file.
15. **Portal integration required zero portal code changes**: `GET
    /v1/exchanges?direction=OUTBOUND&status=READY` (the same endpoint
    cdep's Downloads page already calls) lists these real Gold-derived
    exchanges identically to any other outbound exchange.
16. **data-exchange-service test suite**: all 49 pre-existing tests plus 5
    new integration tests for the outbound-publications module (create→
    upload→complete, idempotent complete, checksum mismatch → FAILED,
    cross-tenant download denial, explicit `/fail`) pass — 54/54.
17. **This service's unit tests**: 15/15 pass (contract loading, schema
    projection incl. required/null-column rejection, cross-tenant
    assertion, Parquet/CSV export round-trips, quality gate pass/fail
    cases).

### Lineage traversal (example queries)

```sql
-- Publication Service DB: publication -> Gold snapshot/pipeline run
SELECT publication_id, source_gold_snapshot_id, source_pipeline_run_id,
       outbound_exchange_id
FROM publication.publication_runs
WHERE publication_id = 'pub-...';

-- Lakehouse DB: Gold pipeline run -> Silver pipeline run -> ingestion
SELECT pipeline_run_id, pipeline_type, source_pipeline_run_id,
       source_ingestion_id, source_table, target_table, target_snapshot_id
FROM lakehouse.pipeline_runs
WHERE pipeline_run_id = 'run-...'
   OR pipeline_run_id IN (
     SELECT source_pipeline_run_id FROM lakehouse.pipeline_runs WHERE pipeline_run_id = 'run-...'
   );

-- Lakehouse DB: ingestion -> original inbound exchange/file
SELECT ingestion_id, exchange_id, source_filename, bronze_table
FROM lakehouse.ingestion_runs
WHERE ingestion_id = 'ing-...';
```

## Reconciliation

`scripts/reconcile_publications.py` is read-only and idempotent — it never
mutates a `publication_runs` row. It flags: publications stuck in a
non-terminal status past `--stale-minutes`, an outbound exchange whose
Exchange Service status disagrees with a local `READY`, and lookup
failures (which, for a still-`PREPARING` exchange, is itself informative:
`manifest.json` doesn't exist until `complete` runs, so a lookup failure
there means "artifact upload never completed"). It is not a scheduler —
run it manually or wire it into cron/CI.

## No distributed transactions

Consistent with AGENTS.md §44: no two-phase commit across Iceberg,
Publication Postgres, Exchange Postgres, and object storage. Consistency
is achieved through explicit statuses (`CREATED` → ... → `READY`/`FAILED`),
idempotency keys, checksums, and the reconciliation script above. Known
failure windows: (a) artifact exported + checksummed but the Exchange
Service call fails — publication is `FAILED`, Gold is untouched, retrying
the same `pipeline_run_id` re-exports and re-attempts (cheap at this
dataset size); (b) artifact uploaded to MinIO but the `complete` call
never arrives — the exchange stays `PREPARING` forever until reconciled
manually (no auto-retry loop is implemented).

## Deployment mapping

Business logic (`contracts/`, `transformations/`, `quality/`,
`exporters/`, `services/publication_service.py`) never imports a
cloud SDK directly — only `Settings` and `ExchangeServiceClient`/
`iceberg_reader.py` are environment-specific.

**AWS**: Iceberg catalog → AWS Glue Catalog; MinIO → S3 (Gold bucket and
Exchange outbound bucket); this service's own Postgres → RDS; the CLI
invocation → an ECS/Fargate task or Lambda triggered by an EventBridge
rule on a `GoldReady` event (replacing the current CLI/direct-DB-read
trigger, per AGENTS.md §36); service-to-service auth → IAM role /
SigV4-signed requests instead of the static internal API key.

**GCP**: Iceberg catalog → a GCS-backed catalog (e.g. BigLake Metastore);
MinIO → GCS; this service's own Postgres → Cloud SQL; the CLI invocation →
a Cloud Run job triggered by Pub/Sub on `GoldReady`; service-to-service
auth → a service account + Workload Identity Federation.

Neither mapping changes anything under `transformations/`, `quality/`,
`exporters/`, or the orchestration in `services/publication_service.py`.

## Known limitations / Phase 5 candidates

- Multi-part/multi-file artifacts (one publication -> N files) are
  supported by the data model (`publication_artifacts` is 1:N) but not
  yet exercised — both exporters currently write a single file, which is
  the documented tradeoff for this dataset size (AGENTS.md §46).
- No automatic retry loop for a publication stuck mid-transfer;
  `reconcile_publications.py` only reports, an operator (or a future
  scheduler) re-runs `publish_gold_product.py`.
- JSON/NDJSON export is not implemented (optional per AGENTS.md §17).
- The GoldReady → Publication trigger is CLI/direct-DB-read only, per
  AGENTS.md §36's "do not require an event bus" — a production deployment
  would replace this with the EventBridge/Pub/Sub wiring described above
  without changing any business logic.
