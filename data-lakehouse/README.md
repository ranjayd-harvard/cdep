# data-lakehouse

The platform's data lakehouse: **Ingestion + Bronze** (Phase 2), and the
**Bronze → Silver → Gold transformation pipeline framework** (Phase 3, see
[Phase 3: Bronze → Silver → Gold](#phase-3-bronze--silver--gold) below).
Phase 2 takes a validated inbound exchange from `data-exchange-service`,
reads its source file (CSV/JSON/Parquet), and lands it — faithfully, with
full lineage, exactly once — in an Apache Iceberg Bronze table. Phase 3
turns Bronze into canonical enterprise models in Silver and business-ready
Data Products in Gold.

```
Customer Portal
      │
      ▼
Data Exchange Service
      │
 ExchangeReady
      │
      ▼
┌──────────────────────┐
│   INGESTION LAYER     │
│                       │
│ Exchange Resolution   │
│ Manifest Validation   │
│ File Reader           │
│ Lineage               │
│ Idempotency           │
└──────────┬────────────┘
           │
           ▼
    BRONZE LAKEHOUSE
     Apache Iceberg
           │
           │ BronzeReady
           ▼
┌──────────────────────────┐
│ BRONZE → SILVER PIPELINE │
│  Mapping · Canonicalize  │
│  Dedup · Quality · MERGE │
└────────────┬──────────────┘
             │
             ▼
      SILVER LAKEHOUSE
       silver.event
             │
        SilverReady
             ▼
┌───────────────────────────┐
│ SILVER → GOLD PIPELINE    │
│  Product logic · Metrics  │
│  Grain · Quality · MERGE  │
└────────────┬───────────────┘
             │
             ▼
       GOLD LAKEHOUSE
   gold.event_performance
             │
         GoldReady
             ▼
      FUTURE PUBLICATION

CONTROL / OPERATIONAL DATA:  lakehouse.ingestion_runs, lakehouse.pipeline_runs,
                              lakehouse.pipeline_events, lakehouse.quality_results,
                              lakehouse.lineage_edges, lakehouse.data_products (Postgres)
DATA STORAGE:  Inbound Exchange Storage → Ingestion → Bronze → Silver → Gold (Iceberg, on MinIO/S3)
```

## Engine choice: PyIceberg vs. Spark

AGENTS.md recommends PySpark. This implementation uses **PyIceberg +
PyArrow** instead, for reasons specific to this environment rather than a
disagreement with the recommendation:

- The dev machine has no JVM (`java -version` fails), and PySpark does not
  yet support the installed Python (3.14) — a working Spark path would
  need a JVM plus pinned Spark/Scala/Iceberg-runtime/hadoop-aws jar
  versions resolved inside Docker, which is slow and failure-prone to get
  right in one pass.
- PyIceberg is a first-party Apache Iceberg client (not a workaround) — it
  reads/writes the same table format, the same catalog types, the same
  partitioning and schema-evolution model.
- Ingestion here is single-file, batch-at-a-time — it does not need
  distributed compute. Silver/Gold aggregations over the full Bronze
  history are the more plausible place to introduce Spark later, and
  nothing here blocks that: the storage/catalog abstractions
  (`lakehouse.storage`, `lakehouse.catalog`) don't know or care what engine
  reads them.

`config/spark/spark-defaults.conf` is kept as a placeholder with the
settings a future Spark engine would need.

## Responsibility boundaries

**data-exchange-service owns:** exchange lifecycle, customer uploads, the
exchange manifest, customer authorization, inbound/outbound storage,
signed URLs, portal-facing exchange metadata.

**data-lakehouse owns:** ingestion, Bronze/Silver/Gold data, transformations,
data quality, canonical models, business data products.

The lakehouse never re-implements exchange lifecycle logic, and never
writes into the exchange service's own storage/database. It only *reads*
an exchange's manifest and source file, and *reports back* a translated
status via `ExchangeServiceClient` (see below).

**Bronze is not the inbound upload folder.** The original customer file
stays in exchange-inbound storage untouched; Bronze is a derived,
Iceberg-managed representation built from it:

```
Inbound Exchange File → Manifest → Ingestion Job → Bronze Table
```

## Repository layout

```
data-lakehouse/
├── config/                  application.yaml, per-cloud storage configs, spark placeholder
├── contracts/
│   ├── exchange-manifest.schema.json
│   ├── bronze/<data_product>.yaml          Phase 2 technical ingestion contracts
│   ├── silver/event.yaml                   Phase 3 canonical entity contract
│   └── gold/event-performance.yaml         Phase 3 Data Product contract
├── mappings/bronze_to_silver/event-data-to-event.yaml   config-driven Bronze->Silver mapping
├── src/lakehouse/
│   ├── config/                Settings (env-driven) + Bronze contract models
│   ├── storage/                StorageClient interface + local/S3/GCS adapters
│   ├── exchange/               ExchangeServiceClient (Mock + Http), manifest parsing/validation
│   ├── ingestion/               IngestionContext, service/runner, idempotency, repository, reconcile
│   ├── readers/                 CSV / JSON (ndjson) / Parquet readers
│   ├── bronze/                  lineage, schema, coercion, Iceberg table/writer, BronzeReady notifier
│   ├── catalog/                 Iceberg catalog config + namespace/table/partitioning/scoped-scan helpers
│   ├── contracts/                Silver/Gold contract models + loader + structural validator
│   ├── transformations/          mapping loader/apply, casting, normalization, tiny transform registry
│   ├── quality/                  rule engine, thresholds/policy, results, technical validation (Phase 2)
│   ├── pipelines/                 PipelineContext, PipelineRun repository/status/idempotency, runner, registry, reconciliation
│   ├── silver/                    canonicalizer, deduplicator, quality, lineage, writer/reader, rejects, models/event.py
│   ├── gold/                      product_builder, products/event_performance.py, writer/reader, quality, lineage
│   ├── lineage/                   lineage_edges service (coarse snapshot/run graph)
│   ├── notifications/             SilverReady / GoldReady (+ BronzeReady re-export) completion handoffs
│   ├── observability/            structured logging + metrics
│   └── common/                  errors, ids, time, utils
├── sql/
│   ├── 001_ingestion_runs.sql          Phase 2 ingestion metadata
│   └── 002_pipeline_metadata.sql       Phase 3 pipeline_runs/events, quality_results, lineage_edges, data_products
├── scripts/
│   ├── initialize_catalog.py, create_sample_exchange.py, inspect_bronze.py    (Phase 2)
│   └── run_bronze_to_silver.py, run_silver_to_gold.py, run_event_pipeline.py, inspect_data_product.py  (Phase 3)
├── samples/event-data/           sample CSV/NDJSON/Parquet fixtures + a reference manifest
└── tests/{unit,integration}/
```

## Local setup

Requires Docker, and Python 3.10-3.12 for running the CLI outside a
container (Python 3.11 is what this was built/tested against).

```bash
cd data-lakehouse
cp .env.example .env
make up                 # docker compose up -d postgres minio bucket-init
make venv                # create .venv and pip install -e ".[dev]"
make init-catalog        # create bronze/silver/gold Iceberg namespaces
```

`make up` starts Postgres on **5434** (not 5432/5433 — 5433 is already used
by `data-exchange-service`'s own Postgres on this machine) and MinIO on
**9010/9011** (not 9000/9001, same reason). `bucket-init` creates
`exchange-inbound`, `lakehouse-bronze`, `lakehouse-silver`,
`lakehouse-gold`.

## Docker commands

```bash
make up              # start postgres, minio, bucket-init
make down             # stop everything
make logs              # follow logs
docker compose build ingestion   # build the ingestion runtime image
```

`docker-compose.yml` also defines an `ingestion` service (built from the
repo's `Dockerfile`) for running the same CLI commands inside a container
instead of a local venv.

## Sample ingestion

```bash
make ingest-sample       # stages exc-example-001 (events.csv) and ingests it
make inspect-bronze       # tenant-scoped read of bronze.event_data
make reconcile            # scan for stuck/crashed ingestion runs
```

Or step by step, using the actual scripts:

```bash
python scripts/create_sample_exchange.py \
  --exchange-id exc-example-001 \
  --organization-id org-vobis-org-722aea \
  --tenant-id tenant-default-47d849 \
  --data-product-id event-data --schema-version 1.0 \
  --file samples/event-data/events.csv --format CSV

python -m lakehouse.ingestion.ingestion_runner --exchange-id exc-example-001

python scripts/inspect_bronze.py --table bronze.event_data \
  --organization org-vobis-org-722aea --tenant tenant-default-47d849
```

`create_sample_exchange.py` stages a manifest + data file into
`exchange-inbound`, mirroring what `data-exchange-service` would already
have done during the customer upload flow — `MockExchangeServiceClient`
then reads them back exactly like the real service's manifest/file
metadata.

## Bronze schema

For `event-data` (`contracts/bronze/event-data.yaml`), Bronze carries the
source business columns untouched *by name*, but **coerced to the
contract's declared canonical type** — this is what lets `bronze.event_data`
stay one schema-consistent Iceberg table across CSV (string cells), JSON
(native ints/floats), and Parquet (native types) ingestions of the same
data product. A value that can't be coerced (e.g. non-numeric text in a
numeric field) is quarantined via the reject path, never silently dropped
or defaulted.

| business (from event-data v1.0) | Bronze type |
|---|---|
| `event_id`, `venue_id`, `event_date` | string |
| `tickets_sold` | long |
| `gross_revenue` | double |

Technical metadata columns (documented in
`lakehouse.bronze.metadata_columns.METADATA_COLUMN_DOCS`):

| column | meaning |
|---|---|
| `_organization_id` | owning organization (tenant-isolation boundary, outer) |
| `_tenant_id` | owning tenant (tenant-isolation boundary, inner) |
| `_exchange_id` | exchange that produced this record |
| `_ingestion_id` | ingestion attempt that wrote this record |
| `_data_product_id` | logical data product / Bronze table |
| `_schema_version` | schema version declared by the manifest |
| `_source_file` | original filename as uploaded |
| `_source_path` | bucket/key of the original object in exchange-inbound storage |
| `_source_format` | CSV \| JSON \| PARQUET |
| `_source_received_at` | when the Exchange Service recorded the file as received |
| `_ingested_at` | when this record was written to Bronze |
| `_source_row_number` | 1-based position within the source file |
| `_record_hash` | SHA-256 of the raw source record (technical fingerprint, not a business key) |
| `_source_system` | constant `data-exchange-service` |
| `_source_channel` | ingestion channel from the manifest (e.g. `CUSTOMER_PORTAL`) |

Columns outside the contract's declared fields (schema drift) pass through
with their source-observed type under `PERMISSIVE` mode, and fail ingestion
under `STRICT` mode.

## Tenant isolation

Every Bronze row carries `_organization_id`/`_tenant_id`. All customer-
scoped reads must go through
`lakehouse.catalog.iceberg.scan_tenant_scoped(table, organization_id, tenant_id)`
— never `table.scan()` unfiltered. The one sanctioned privileged escape
hatch is `scan_unscoped(table)`, reserved for internal platform workloads
(reconciliation, admin tooling) and explicitly named so it's never reached
by accident. `scripts/inspect_bronze.py` requires `--organization`/
`--tenant` unless `--admin` is passed. See
`tests/integration/test_multi_tenant.py` for the mandatory two-tenant proof.

## Lineage

Every Bronze record traces back through:

```
_ingestion_id → _exchange_id → _source_file/_source_path → original exchange manifest
```

`lakehouse.ingestion.ingestion_context.IngestionContext` is built
*exclusively* from trusted `ExchangeReady`/manifest data — never from CLI
arguments — and `lakehouse.bronze.lineage.attach_lineage` stamps every
record with it before it reaches Bronze.

## Idempotency

`lakehouse.ingestion.idempotency.check_idempotency` looks up
`lakehouse.ingestion_runs` for a prior `COMPLETED` run with the same
`exchange_id` + `data_product_id` + `schema_version`. If found, the new run
returns `SKIPPED_DUPLICATE` immediately — no re-read, no second Bronze
append. A checksum mismatch against that prior run is logged as a warning
(same `exchange_id` should never legitimately carry two different files)
but does not itself force a re-ingest.

## Error handling

Every raised error carries a stable `error_code` (see
`lakehouse.common.errors`), which is what gets persisted to
`ingestion_runs.error_code`/`error_message` and reported to the Exchange
Service — never a raw stack trace or file content. On failure: the run is
marked `FAILED`, the source object is left untouched, and the same
`exchange_id` can be retried later (idempotency then allows a fresh
attempt since no `COMPLETED` run exists yet). See
`tests/integration/test_duplicate_and_retry.py` for a full
fail-then-retry-succeeds demonstration.

Unreadable *records* (not the whole file) are quarantined rather than
dropped: `lakehouse.ingestion.rejects.write_rejects` writes JSONL to
`lakehouse-bronze/rejects/{data_product_id}/{ingestion_id}/rejects.jsonl`
with the row number, raw payload, and error.

## Iceberg architecture

Local catalog: PyIceberg's `SqlCatalog`, metadata in Postgres (schema
`iceberg_catalog` — separate from the `lakehouse` schema that holds
`ingestion_runs`). Namespaces: `bronze`, `silver`, `gold` — all three live
in this *same* catalog and this *same* Postgres/MinIO pair; Silver and Gold
do not get their own containers when implemented.

The catalog's single `warehouse` setting defaults to the Bronze bucket, so
`lakehouse.catalog.iceberg.get_or_create_table` always passes an explicit
per-table `location` (`Settings.location_for_table`, namespace → bucket:
`bronze`→`lakehouse-bronze`, `silver`→`lakehouse-silver`,
`gold`→`lakehouse-gold`) when creating a table. Without that explicit
location, a `silver.*`/`gold.*` table would silently land inside the
Bronze bucket instead of its own — each medallion layer keeps its own
physical bucket (AGENTS.md section 5) even though they all share one
MinIO instance.

Bronze tables are **append-only** — a new ingestion adds a new batch,
distinguished by `_exchange_id`/`_ingestion_id`/`_tenant_id`; it never
rewrites history.

**Partitioning:** `_tenant_id` (identity) + `days(_ingested_at)`. This keeps
per-tenant, per-day scans cheap without over-partitioning by
high-cardinality `_exchange_id` or creating a directory-per-user layout.

**Schema evolution:** `PERMISSIVE` (default) allows additive columns via
`union_by_name`; `STRICT` fails ingestion on any drift from the contract's
declared fields. Configured per data product in
`contracts/bronze/<id>.yaml` → `schema.mode`.

## AWS migration path

| Concern | Local | AWS |
|---|---|---|
| Exchange inbound | MinIO | S3 |
| Bronze/Silver/Gold storage | MinIO | S3 |
| Table format | Iceberg | Iceberg (unchanged) |
| Catalog | PyIceberg `SqlCatalog` (Postgres) | AWS Glue Data Catalog (or another Iceberg-compatible catalog) |
| Storage adapter | `S3CompatibleStorage` (MinIO endpoint) | `S3CompatibleStorage` (default AWS endpoint) |

See `config/storage/aws-s3.yaml`. Switching is a configuration change in
`lakehouse.catalog.catalog.build_catalog` / `lakehouse.storage.build_storage_client`
— `ingestion_service.py`, `bronze_writer.py`, and `lineage.py` do not
change. Logical table names (`bronze.event_data`, future `silver.event`,
`gold.event_performance`) stay the same.

## GCP migration path

| Concern | Local | GCP |
|---|---|---|
| Exchange inbound | MinIO | Google Cloud Storage |
| Bronze/Silver/Gold storage | MinIO | Google Cloud Storage |
| Table format | Iceberg | Iceberg (unchanged) |
| Catalog | PyIceberg `SqlCatalog` (Postgres) | Any Iceberg-compatible catalog reachable from GCP |
| Storage adapter | `S3CompatibleStorage` | `GCSStorage` (interface-complete, implementation pending — see `lakehouse/storage/gcs_storage.py`) |

See `config/storage/gcs.yaml`. `GCSStorage` satisfies the same
`StorageClient` protocol; filling in its methods (when a GCP environment
becomes available) requires no ingestion business-logic changes.

## Phase 3: Bronze → Silver → Gold

Phase 3 turns Bronze into canonical enterprise models (Silver) and
consumer-ready Data Products (Gold), as a **contract-driven, reusable
transformation framework** — adding a new entity/product is meant to be
mostly configuration (a contract + a mapping + a registry entry), not a
copy-pasted pipeline. Customer publication/download packaging is explicitly
**out of scope** for Phase 3 (see [Future Publication Service](#future-publication-service)).

### Bronze vs. Silver vs. Gold responsibilities

| | Bronze | Silver | Gold |
|---|---|---|---|
| Shape | Source-faithful | Canonical enterprise entity | Business-ready Data Product |
| Write pattern | Append-only | Upsert/MERGE on business key | Upsert/MERGE on declared grain |
| Typing | Contract-declared, minimal | Fully typed (date, decimal, long) | Inherits Silver's types + derived metrics |
| Dedup | None (raw batches) | Yes, on tenant-scoped business key | Grain-enforced (no dedup needed if Silver is already deduped) |
| Business logic | None | Standardization only | Metrics, derived columns, business rules |
| Consumers | Internal only | Internal only | Entitled external/internal consumers |

### Canonical data model concept

Silver represents **one enterprise-wide definition of an entity**,
independent of which customer/format/channel it arrived through. For this
slice: `silver.event` — `event_id`, `venue_id`, `event_date`,
`tickets_sold`, `gross_revenue`, canonically typed, plus lineage. Adding a
tenant-specific quirk never means hacking the shared Silver model — it
means a mapping/contract override, never `if tenant_id == "..."` in
transformation code.

### Data Product concept

A Gold Data Product is not just "another transformed table" — it carries an
explicit **contract**: id, version, owner, business definition, schema,
freshness SLA, quality rules, lineage, and a publication section (metadata
only in Phase 3 — see scope boundary). `lakehouse.data_products` is a
lightweight operational registry (id, display name, version, gold table,
owner, status) seeded with `event-performance` / `ACTIVE`.

### Contracts

Two new contract types, loaded via `lakehouse.contracts.loader` into
pydantic models (`lakehouse.contracts.models`):

- **Silver contract** (`contracts/silver/event.yaml`): `entity`, `version`,
  `owner`, `businessKey`, `quality.rules` + `quality.policy`,
  `deduplication` (order_by/tiebreaker), `incremental.strategy`.
- **Gold contract** (`contracts/gold/event-performance.yaml`):
  `dataProduct` (id/name/version/owner/description), `source.table`,
  `grain` (description) + `keys` (enforced grain columns), `schema`
  (customer-facing column list — see [Customer-facing contract vs.
  physical Gold table](#customer-facing-contract-vs-physical-gold-table)),
  `sla.freshnessMinutes`, `quality`, `publication.formats` (metadata only).

Both are separate from `lakehouse.config.models.DataProductContract`
(Bronze's *technical* ingestion contract) — Silver/Gold contracts describe
canonical/business shape, not source-format parsing.

### Mapping framework

`mappings/bronze_to_silver/event-data-to-event.yaml`, loaded via
`lakehouse.transformations.mapping.load_mapping` into a `MappingConfig`.
Per target field: `source` column, canonical `type` (`string`, `long`,
`double`, `boolean`, `date`, `decimal(p,s)`), `required`, `default`, and an
optional named `transform` (a tiny registry — `trim`/`upper`/`lower`/
`collapse_whitespace` in `lakehouse.transformations.expressions` —
deliberately **not** a general ETL expression language, per design
constraint). `apply_mapping()` casts every declared field via
`lakehouse.transformations.casting.cast_value`; an unparseable *required*
field returns a `MappedRecord` with `.error` set — the caller quarantines
it, it is never silently dropped or defaulted.

### Incremental processing

Both stages read only the relevant slice, never the whole table:

- **Bronze → Silver**: `lakehouse.catalog.iceberg.scan_ingestion_scoped`
  filters Bronze by `_organization_id`/`_tenant_id`/`_ingestion_id` — one
  ingestion batch only.
- **Silver → Gold**: `lakehouse.catalog.iceberg.scan_pipeline_run_scoped`
  filters Silver by `organization_id`/`tenant_id`/`pipeline_run_id` — only
  the rows the upstream Bronze→Silver run just wrote/updated. Updating one
  event in Bronze recomputes exactly that event in Gold, not the tenant's
  full history.

### MERGE semantics (Iceberg upsert)

Silver and Gold both write via `Table.upsert(df, join_cols=...)`
(PyIceberg's native MERGE — join on the business key/grain, update matched
rows, insert new ones) — never a full table rebuild:

- `lakehouse.silver.silver_writer.write_silver` — `join_cols =
  SilverContract.business_key` (`["organization_id", "tenant_id",
  "event_id"]`).
- `lakehouse.gold.gold_writer.write_gold` — `join_cols =
  GoldDataProductContract.keys` (same triple — the declared grain).

Both preserve the original `silver_created_at`/`_created_at` across an
update (looked up from the existing matching row before the upsert) so a
MERGE's `when_matched_update_all` doesn't clobber creation history —
`silver_updated_at`/`_updated_at` always reflects the latest write.

### Deduplication

`lakehouse.silver.deduplicator.deduplicate`: among canonical records
sharing the same tenant-scoped business key, keeps the one with the
greatest `_source_received_at` (configurable via the Silver contract's
`deduplication.order_by`), falling back to `_ingested_at`
(`deduplication.tiebreaker`) on a tie. Operates strictly within one
business key's tenant scope — it is structurally impossible to deduplicate
across tenants since `organization_id`/`tenant_id` are always part of the
key.

### Data quality

`lakehouse.quality.engine.run_quality_rules` evaluates contract-declared
rules (`not_null`, `unique`, `min`, `max`, `allowed_values`, `regex`,
`date_range`) against a batch of records, returning per-rule
`total_count`/`failed_count`/`failure_percentage`/`severity`/`passed` plus
the *exact record indices* that failed (so only offending rows are
quarantined, not the whole batch). `lakehouse.quality.thresholds
.evaluate_policy` turns those into a `QualityDecision` per the contract's
`qualityPolicy`:

```yaml
quality:
  policy:
    errorThresholdPercent: 1.0
    onFailure:
      quarantineInvalidRecords: true   # always pull failing ERROR rows out
      failPipeline: false               # only fail the whole run if BOTH
                                          # fail_pipeline=true AND over threshold
```

Results are persisted to `lakehouse.quality_results` — one row per
(pipeline_run, rule), not one row per record — via
`lakehouse.quality.engine.persist_quality_results`.

### Reject handling

Both canonicalization failures (unparseable required field) and
quality-quarantined records are written as JSONL to
`lakehouse-silver/silver-rejects/{entity}/{pipeline_run_id}/rejects.jsonl`
via `lakehouse.silver.rejects.write_silver_rejects` — the "equivalent
standardized technical namespace" in place of a literal `silver_rejects.event`
table, consistent with how Bronze already quarantines unreadable records
(`lakehouse.ingestion.rejects`) as object-storage JSONL rather than a table.
Each entry carries `organization_id`/`tenant_id`/`source_exchange_id`/
`source_ingestion_id`/`pipeline_run_id`/`raw_record`/`error_code`/
`error_message`/`failed_rules`/`rejected_at`. Nothing is ever silently
dropped.

### Tenant isolation

Every Silver/Gold row carries **unprefixed** `organization_id`/`tenant_id`
as first-class canonical columns (not `_`-prefixed technical metadata like
Bronze's `_organization_id`/`_tenant_id` — Silver/Gold treat tenant
ownership as core business shape, per the contracts above).
`lakehouse.catalog.iceberg.scan_tenant_scoped` takes `org_column`/
`tenant_column` parameters (defaulting to Bronze's prefixed names) so the
*same* tenant-scoping helper serves all three layers without duplicating
the filter-building logic. The business key/grain for Event always
includes `organization_id` + `tenant_id` before `event_id` — see the
mandatory two-tenant test below. `scan_unscoped` remains the one sanctioned,
explicitly-named privileged escape hatch (reconciliation, `--admin`
inspection tooling).

### Lineage

Two complementary mechanisms:

1. **Record-level** (every Silver/Gold row): `source_exchange_id`,
   `source_ingestion_id`, `pipeline_run_id` (Silver) /
   `_gold_pipeline_run_id` + `_silver_pipeline_run_id` (Gold), plus
   `source_bronze_snapshot_id`/`source_record_hash` on Silver.
2. **Coarse snapshot graph** (`lakehouse.lineage_edges`, via
   `lakehouse.lineage.lineage_service.LineageService`): one edge per
   `bronze_table@snapshot → silver_table@snapshot`,
   `ingestion_id → silver_table@snapshot`, and
   `silver_table@snapshot → gold_table@snapshot` per pipeline run.

See [Lineage trace investigation](#lineage-trace-investigation-example) for
how a developer walks this end to end.

### Iceberg snapshots

Every `pipeline_runs` row records `source_snapshot_id` (the Bronze/Silver
snapshot read from) and `target_snapshot_id` (the Silver/Gold snapshot
produced) — both taken from `table.current_snapshot().snapshot_id` before
and after the write. This is what makes reconciliation and lineage-tracing
precise (which exact snapshot did this run consume/produce), and is the
basis for future time-travel debugging (`catalog.load_table(...).scan(
snapshot_id=...)`, unchanged code path).

### Pipeline metadata

`lakehouse.pipelines.pipeline_repository.PipelineRepository` persists to
`lakehouse.pipeline_runs` (one row per Bronze→Silver or Silver→Gold
execution — see schema below) and `lakehouse.pipeline_events` (append-only
event trail: `PIPELINE_CREATED`, `SOURCE_READ_STARTED/COMPLETED`,
`VALIDATION_STARTED`, `TRANSFORMATION_STARTED`, `SILVER_WRITE_STARTED/
COMPLETED`, `QUALITY_CHECK_STARTED/FAILED`, `GOLD_WRITE_STARTED/COMPLETED`,
`SILVER_READY`/`GOLD_READY`, `PIPELINE_COMPLETED`/`PIPELINE_FAILED`).
Mirrors Phase 2's `IngestionRepository` shape deliberately.

### Reprocessing

`--reprocess` (both `run_bronze_to_silver.py` and `run_silver_to_gold.py`,
also propagated by `run_event_pipeline.py`) forces
`lakehouse.pipelines.idempotency.check_pipeline_idempotency` to skip its
skip-check and always create a **new** `pipeline_run_id` — prior runs are
never overwritten or deleted, so audit history accumulates rather than
being replaced. Without `--reprocess`, an ingestion/silver-run already
processed by the same `pipeline_version`+`contract_version`+
`mapping_version` combination is detected via
`PipelineRepository.find_successful_run` and returns
`SKIPPED_DUPLICATE` immediately.

### Customer-facing contract vs. physical Gold table

Physical `gold.event_performance` carries more columns than the Gold
contract's `schema` section declares: `_gold_pipeline_run_id`,
`_silver_pipeline_run_id`, `_product_id`, `_product_version`,
`_created_at`, `_updated_at` are internal technical lineage
(`lakehouse.gold.lineage.attach_gold_lineage`), never customer-facing
business columns. The contract's `schema` block (`event_id`, `venue_id`,
`event_date`, `tickets_sold`, `gross_revenue`, `revenue_per_ticket`) is the
**only** column list a future Publication layer should select from when
building an external export — selecting `SELECT *` from the physical table
for a customer-facing artifact would leak tenant/pipeline internals that
exist purely for platform observability. This is why the `_`-prefix
convention on Gold lineage columns mirrors Bronze's, even though Silver/Gold
otherwise use *unprefixed* `organization_id`/`tenant_id` (see [Tenant
isolation](#tenant-isolation-1) above) — the prefix here specifically marks
"never publish this column", not "this is Bronze-only".

### AWS/GCP migration (Phase 3 additions)

Same story as Phase 2 (see below) — nothing new to change. `silver.event`
and `gold.event_performance` are ordinary Iceberg tables in the `silver`/
`gold` namespaces, in their own buckets (`lakehouse-silver`/
`lakehouse-gold`), read/written exclusively through
`lakehouse.catalog.iceberg` + `lakehouse.silver.silver_writer` /
`lakehouse.gold.gold_writer` — none of which touch AWS/GCP APIs directly.
Canonicalization, mapping, quality rules, and Gold product logic
(`lakehouse.gold.products.event_performance`) are pure Python/PyArrow and
require zero changes when swapping the catalog (Glue) or storage adapter
(S3/GCS).

### Future Publication Service

Explicitly out of scope for Phase 3 (AGENTS.md section 63): customer
download packaging, outbound exchange artifacts, REST APIs for Gold, and a
message broker (Kafka/Pub/Sub/EventBridge) for `GoldReady` are all future
work. The seam is already in place: `lakehouse.notifications.gold_ready
.GoldCompletionNotifier` is a `Protocol` — only
`LoggingGoldCompletionNotifier` exists today; a future Publication Service
implements the same protocol and is wired in at
`lakehouse.pipelines.pipeline_runner.run_silver_to_gold`'s `notifier`
parameter with no changes to pipeline logic. See [Recommended Phase 4
architecture](#recommended-phase-4-architecture).

### Pipeline registry (contract-driven framework)

`lakehouse.pipelines.registry` is a plain dict-based registry (no workflow
engine) mapping a Bronze `data_product_id` to its Silver entity/mapping/
pipeline name, and a Gold `data_product_id` to its source Silver entity,
Arrow schema, grain key, and pure-Python builder function:

```python
BRONZE_TO_SILVER_PIPELINES = {
    "event-data": BronzeToSilverRegistration(
        data_product_id="event-data", pipeline_name="event-bronze-to-silver",
        pipeline_version="1.0", mapping_id="event-data-to-event",
        silver_entity="event", gold_products=["event-performance"],
    ),
}
SILVER_TO_GOLD_PIPELINES = {
    "event-performance": SilverToGoldRegistration(
        data_product_id="event-performance", pipeline_name="event-performance-silver-to-gold",
        pipeline_version="1.0", source_silver_entity="event",
        gold_table_name="event_performance", schema=GOLD_EVENT_PERFORMANCE_SCHEMA,
        date_column="event_date", grain_key=[...], builder=build_event_performance,
    ),
}
```

A future `bronze.transaction_data → silver.transaction →
gold.transaction_summary` pipeline needs: a new Bronze contract (existing
Phase 2 mechanism), a new Silver contract + mapping YAML, a new Gold
contract, a `build_transaction_summary()` pure function, and three registry
entries — logging, pipeline metadata, idempotency, quality, and lineage are
all inherited for free from `lakehouse.pipelines.pipeline_runner`.

### Pipeline metadata schema

```sql
-- lakehouse.pipeline_runs (see sql/002_pipeline_metadata.sql)
pipeline_run_id, pipeline_name, pipeline_type,           -- BRONZE_TO_SILVER | SILVER_TO_GOLD
organization_id, tenant_id,
source_table, target_table,
source_exchange_id, source_ingestion_id, source_pipeline_run_id,
data_product_id,
pipeline_version, contract_version, mapping_version,
source_snapshot_id, target_snapshot_id,
status,                                                    -- CREATED..COMPLETED/FAILED/SKIPPED_DUPLICATE
input_record_count, output_record_count, rejected_record_count,
started_at, completed_at, error_code, error_message, created_at, updated_at

-- lakehouse.pipeline_events (append-only)
pipeline_event_id, pipeline_run_id, event_type, event_data JSONB, occurred_at
```

### Quality schema

```sql
-- lakehouse.quality_results
quality_result_id, pipeline_run_id, organization_id, tenant_id,
layer,                    -- SILVER | GOLD
table_name, rule_name, severity,           -- INFO | WARNING | ERROR
total_count, failed_count, failure_percentage, passed, evaluated_at
```

### Lineage schema

```sql
-- lakehouse.lineage_edges
lineage_edge_id, source_type, source_identifier,   -- e.g. "bronze_table", "ing-..."
target_type, target_identifier,                     -- e.g. "silver_table", "silver.event@<snapshot>"
pipeline_run_id, organization_id, tenant_id, created_at

-- lakehouse.data_products
data_product_id, display_name, version, gold_table, owner, description,
status,                   -- DRAFT | ACTIVE | DEPRECATED
created_at, updated_at
```

### Silver Event contract (`contracts/silver/event.yaml`)

```yaml
entity: event
version: "1.0"
owner: data-platform
businessKey: [organization_id, tenant_id, event_id]
deduplication: { order_by: _source_received_at, tiebreaker: _ingested_at }
incremental: { strategy: UPSERT }
quality:
  rules:
    - { name: event_id_required, type: not_null, column: event_id, severity: ERROR }
    - { name: venue_id_required, type: not_null, column: venue_id, severity: ERROR }
    - { name: event_date_valid, type: not_null, column: event_date, severity: ERROR }
    - { name: tickets_non_negative, type: min, column: tickets_sold, value: 0, severity: ERROR }
    - { name: revenue_non_negative, type: min, column: gross_revenue, value: 0, severity: ERROR }
  policy:
    errorThresholdPercent: 1.0
    onFailure: { quarantineInvalidRecords: true, failPipeline: false }
```

### Bronze → Silver mapping (`mappings/bronze_to_silver/event-data-to-event.yaml`)

```yaml
source: { table: bronze.event_data, dataProductId: event-data }
target: { table: silver.event, entity: event }
keys: { businessKey: [event_id] }
mapping:
  event_id:      { source: event_id,      type: string,        required: true }
  venue_id:      { source: venue_id,      type: string,        required: true }
  event_date:    { source: event_date,    type: date,          required: true }
  tickets_sold:  { source: tickets_sold,  type: long,           required: false }
  gross_revenue: { source: gross_revenue, type: "decimal(18,2)", required: false }
lineage: { source_exchange_id: _exchange_id, source_ingestion_id: _ingestion_id }
```

### Gold Event Performance contract (`contracts/gold/event-performance.yaml`)

```yaml
dataProduct: { id: event-performance, name: Event Performance, version: "1.0", owner: Event Analytics }
source: { table: silver.event }
grain: "One row per organization_id, tenant_id and event_id."
keys: [organization_id, tenant_id, event_id]
schema:
  event_id: { type: string, required: true }
  venue_id: { type: string, required: true }
  event_date: { type: date, required: true }
  tickets_sold: { type: long, required: false }
  gross_revenue: { type: "decimal(18,2)", required: false }
  revenue_per_ticket: { type: "decimal(18,2)", required: false }
sla: { freshnessMinutes: 240 }
quality: { minimumCompletenessPercent: 99, rules: [...], policy: {...} }
publication: { formats: [PARQUET, CSV] }   # metadata only -- not implemented in Phase 3
```

### Iceberg table definitions & partitioning decisions

| Table | Namespace/bucket | Partitioning | Why |
|---|---|---|---|
| `bronze.event_data` | `bronze` / `lakehouse-bronze` | `_tenant_id` (identity) + `days(_ingested_at)` | Phase 2, unchanged |
| `silver.event` | `silver` / `lakehouse-silver` | `tenant_id` (identity) + `month(event_date)` | Per-tenant, per-month scans stay cheap; avoids high-cardinality `event_id`/`exchange_id`/`ingestion_id` partitions |
| `gold.event_performance` | `gold` / `lakehouse-gold` | `tenant_id` (identity) + `month(event_date)` | Same reasoning — Gold reads are typically "this tenant, this date range" |

Partition specs are set once at table creation
(`lakehouse.catalog.iceberg.apply_tenant_and_month_partitioning`, a
partition-function factory passed into the shared `get_or_create_table`)
and are not retroactively rewritten for existing tables — Iceberg partition
evolution would apply going forward if the strategy changes later.

### Change history / SCD note

Phase 3 implements Silver as **current-state canonical entities** (an
upsert replaces the previous value for a business key), not a full SCD
Type 2 history. Enough lineage survives to audit *when* + *by which
pipeline run* a value last changed (`silver_updated_at`, `pipeline_run_id`,
per-run `pipeline_events`), but not full historical value tracking beyond
what Iceberg snapshot time-travel already offers (see below). A future SCD
Type 2 Silver entity would add `valid_from`/`valid_to`/`is_current`
columns and switch the write path from `upsert()` to an explicit
close-old-row + insert-new-row pattern — a meaningfully different write
strategy, not a small tweak, so it's deliberately not built speculatively
here.

### Time travel

Iceberg's snapshot history is untouched by any Phase 3 code — every
`table.upsert()` call creates a new snapshot without deleting prior ones.
To inspect a prior state for debugging/audit:

```python
from lakehouse.catalog.catalog import get_catalog
table = get_catalog().load_table("silver.event")
for snap in table.history():
    print(snap.snapshot_id, snap.timestamp_ms)
prior_state = table.scan(snapshot_id=<older_snapshot_id>).to_arrow().to_pandas()
```

This is a debugging/audit capability only — no customer-facing time-travel
API is exposed (out of scope, section 63).

### Recommended Phase 4 architecture

1. **Publication Service**: consumes `GoldReady` (today: a log line from
   `LoggingGoldCompletionNotifier`; Phase 4: a real notifier implementation
   — Kafka/Pub/Sub/EventBridge or a workflow trigger), selects only the
   Gold contract's customer-facing `schema` columns (never the `_`-prefixed
   lineage columns), and writes PARQUET/CSV artifacts into a new outbound
   exchange via `data-exchange-service`.
2. **REST API for Gold**: a superadmin/internal API (mirroring
   `lakehouse/api/`) to trigger/inspect Silver→Gold runs from the portal,
   the way `POST /internal/v1/ingestion-runs` already does for Bronze.
3. **Entitlement model**: which tenant/consumer may access which Data
   Product/columns — currently Gold rows are tenant-scoped but there's no
   separate "who may read this Data Product" concept yet.
4. **SCD Type 2 Silver** for entities that need historical state (see
   above) once a concrete requirement exists.
5. **Message broker** replacing the `Logging*CompletionNotifier`
   implementations across Bronze/Silver/Gold, once cross-service
   orchestration needs to be decoupled from synchronous CLI/API calls.
6. Revisit the PyIceberg-vs-Spark decision (see Phase 2's rationale above)
   once Gold aggregations need to scan/join full multi-tenant history
   rather than one incremental batch at a time.

### Sample commands

```bash
# Bronze -> Silver for one completed ingestion (Phase 2 must have run first)
python scripts/run_bronze_to_silver.py --ingestion-id ing-example-001

# Silver -> Gold for one completed Bronze->Silver run (all registered Gold
# products, or --product-id to pick one)
python scripts/run_silver_to_gold.py --silver-run-id run-example-001

# End-to-end Bronze -> Silver -> Gold in one command
python scripts/run_event_pipeline.py --ingestion-id ing-example-001

# Explicit controlled reprocessing (new pipeline_run_id, prior runs kept)
python scripts/run_event_pipeline.py --ingestion-id ing-example-001 --reprocess

# Tenant-scoped Gold inspection (requires --organization/--tenant unless --admin)
python scripts/inspect_data_product.py --product event-performance \
  --organization org-vobis-org-722aea --tenant tenant-default-47d849

# Reconciliation: Bronze without Silver, Silver without Gold, stuck runs
python -m lakehouse.pipelines.reconciliation
```

Or via `make`: `make run-event-pipeline INGESTION_ID=ing-example-001`,
`make inspect-gold`, `make reconcile-pipelines` (see the Makefile).

### Example queries

```python
# Tenant-scoped Silver read (never table.scan() unfiltered for customer data)
from lakehouse.catalog.catalog import get_catalog
from lakehouse.catalog.iceberg import scan_tenant_scoped

table = get_catalog().load_table("silver.event")
rows = scan_tenant_scoped(
    table, organization_id="org-vobis-org-722aea", tenant_id="tenant-default-47d849",
    org_column="organization_id", tenant_column="tenant_id",
).to_arrow().to_pandas()
```

```sql
-- Which pipeline run produced a given Gold snapshot, and what did it read?
SELECT pipeline_run_id, source_table, source_snapshot_id, target_table, target_snapshot_id,
       input_record_count, output_record_count, rejected_record_count, status
FROM lakehouse.pipeline_runs
WHERE pipeline_run_id = 'run-...';

-- Quality results for one run
SELECT rule_name, severity, total_count, failed_count, failure_percentage, passed
FROM lakehouse.quality_results WHERE pipeline_run_id = 'run-...';
```

### Lineage trace investigation (example)

To answer "where did this `gold.event_performance` row for EVT1001 come
from":

```sql
-- 1. Which Gold pipeline run wrote it? (also visible on the row itself as
--    _gold_pipeline_run_id / _silver_pipeline_run_id)
SELECT * FROM lakehouse.pipeline_runs WHERE pipeline_run_id = '<_gold_pipeline_run_id>';

-- 2. Its source_pipeline_run_id points at the Bronze->Silver run:
SELECT * FROM lakehouse.pipeline_runs WHERE pipeline_run_id = '<source_pipeline_run_id>';

-- 3. That row's source_ingestion_id / source_exchange_id are the Phase 2
--    ingestion + exchange:
SELECT * FROM lakehouse.ingestion_runs WHERE ingestion_id = '<source_ingestion_id>';

-- 4. lineage_edges gives the same chain as snapshot-to-snapshot edges,
--    useful when walking forward from Bronze instead of backward from Gold:
SELECT * FROM lakehouse.lineage_edges WHERE target_identifier LIKE 'gold.event_performance@%'
ORDER BY created_at DESC;
```

`ingestion_runs.source_filename`/`source_path` (Phase 2) is the final hop
back to the original customer upload. This full chain —
`gold.event_performance` → Gold pipeline run → `silver.event` → Silver
pipeline run → `bronze.event_data` → ingestion → exchange → original
upload — was manually verified during Phase 3 development end-to-end.

### Multi-tenant test (mandatory)

`tests/integration/test_phase3_pipeline.py
::test_two_tenants_with_same_event_id_remain_isolated_in_silver_and_gold`
ingests `event_id=EVT6001` for two different (organization, tenant) pairs
and asserts both `silver.event` and `gold.event_performance` end up with
two fully independent rows — updating one tenant's row never touches the
other's. This mirrors Phase 2's `test_multi_tenant.py` requirement, extended
through Silver and Gold.

## Real E2E via the portal UI

`HttpExchangeServiceClient` talks to a real `data-exchange-service`
instance via its internal-only `GET /internal/v1/exchanges/{id}/manifest`
endpoint (gated by `x-internal-api-key`, not customer JWT auth — mirrors
that service's existing `/internal/v1/publications` pattern). It returns
the already-written manifest verbatim plus the data file's own storage
coordinates.

Because the uploaded file physically lives in `data-exchange-service`'s
own MinIO (port 9000), not this lakehouse's (port 9010), `IngestionService`
takes a separate `source_storage` client for reading the exchange-inbound
object, distinct from `storage` (this lakehouse's own Bronze/Silver/Gold +
rejects). `ingestion_runner.py` only builds the separate client when
`LAKEHOUSE_EXCHANGE_CLIENT=http`; in `mock` mode both are the same client.

To test with a real file uploaded through the actual customer portal UI:

```bash
# 1. Have data-exchange-service running (docker compose up -d, port 8080)
#    and the portal running (localhost:3091), pointed at it.
# 2. Log into the portal and upload a file via the Upload page. Note the
#    exchangeId shown on the resulting exchange detail page, and wait for
#    its status to reach VALIDATED.
# 3. Ingest it for real:
LAKEHOUSE_EXCHANGE_CLIENT=http \
LAKEHOUSE_EXCHANGE_SERVICE_API_KEY=dev-internal-key-change-me \
python -m lakehouse.ingestion.ingestion_runner --exchange-id <the exchangeId>
# 4. Verify it landed:
python scripts/inspect_bronze.py --table bronze.event_data \
  --organization <your org id> --tenant <your tenant id>
```

This was verified end-to-end against a real upload (not just the sample
fixtures): `POST /v1/uploads` → PUT to the signed URL → `POST
/v1/uploads/{id}/complete` → `ingestion_runner --exchange-id` in `http`
mode → the row appeared in `bronze.event_data` with correct lineage.

## HTTP API (superadmin portal integration)

`src/lakehouse/api/` is a small internal-only HTTP wrapper around the same
`IngestionService`/`IngestionRepository` the CLI uses — it exists purely so
the portal's `/admin/lakehouse` superadmin page can trigger ingestion for an
exchange and show its status without a terminal. It is **not** part of the
ingestion pipeline's own contract; nothing in `ingestion_runner.py` or the
pipeline depends on it.

Every route requires the `x-internal-api-key` header, checked against
`LAKEHOUSE_INTERNAL_API_KEY` — a separate key from
`LAKEHOUSE_EXCHANGE_SERVICE_API_KEY` (that one is *outbound* auth to
data-exchange-service; this one is *inbound* auth to this service).

```bash
make api   # uvicorn lakehouse.api.app:app --reload --port 8000
# or: docker compose up -d api   (port 8090 on the host)

curl -H "x-internal-api-key: $LAKEHOUSE_INTERNAL_API_KEY" \
  "http://localhost:8000/internal/v1/ingestion-runs?exchange_id=exc-example-001"

curl -X POST -H "x-internal-api-key: $LAKEHOUSE_INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"exchange_id": "exc-example-001"}' \
  http://localhost:8000/internal/v1/ingestion-runs
```

- `GET /internal/v1/ingestion-runs?exchange_id=&limit=` — with `exchange_id`,
  the full run history for that exchange (`IngestionRepository.list_by_exchange`);
  without it, the most recent runs across every exchange (`list_recent`).
- `POST /internal/v1/ingestion-runs` `{exchange_id}` — runs
  `IngestionService.run(exchange_id)` synchronously and returns the resulting
  `IngestionOutcome`. `ExchangeNotFoundError` → 404, any other precondition
  failure (`ExchangeNotReadyError`, `ManifestValidationError`, ...) → 409.
  A failure *inside* ingestion (e.g. a Bronze write error, after the run row
  already exists) is **not** an HTTP error — it's a normal 200 response with
  `"status": "FAILED"` in the body, exactly like a CLI run's exit code vs. its
  logged outcome.
- Handlers are synchronous (`def`, not `async def`) since nothing in this
  codebase uses asyncio — FastAPI/Starlette run sync path operations in a
  threadpool automatically, so this doesn't block the event loop.
- The `IngestionService` object graph is built once at process startup
  (`app.py`'s `lifespan`), not per-request — safe because `get_engine()`/
  `get_catalog()` are already process-wide singletons designed for
  concurrent use.

## Known limitations / assumptions

- `data-exchange-service` still has no ingestion-status-callback
  endpoints: `mark_processing`/`mark_ingestion_complete`/
  `mark_ingestion_failed`/`record_ingestion_reference` degrade to warning
  logs instead of failing ingestion, even in `http` mode. Wiring the real
  callbacks once Phase 1 adds them requires no changes outside
  `lakehouse/exchange/client.py`.
- `reconcile.py` detects ingestion runs stuck in a non-terminal status
  (crash between `PROCESSING` and a terminal outcome) and reports whether
  the source object is still present. It does **not** yet detect "Bronze
  commit exists but the metadata DB update failed" — that needs diffing
  Iceberg snapshot manifests against `ingestion_runs`, a reasonable Phase 3
  addition once Silver needs stronger exactly-once guarantees.
- `S3CompatibleStorage.open()` buffers the whole object into memory
  (`io.BytesIO`) rather than true streaming — boto3's raw `StreamingBody`
  is neither seekable (Parquet needs random access) nor behaves like a
  normal file object after EOF (breaks `io.TextIOWrapper`, used by the
  CSV/JSON readers). Fine at exchange-file scale; revisit for very large
  sources.
- No message broker/orchestrator is introduced for `BronzeReady` yet, per
  AGENTS.md section 47 ("do NOT introduce Kafka yet").
- `lakehouse.pipelines.reconciliation` extends the "stuck non-terminal run"
  and "Bronze without Silver" / "Silver without Gold" checks, but — like
  Phase 2's `reconcile.py` — does not yet diff Iceberg snapshot manifests
  against `pipeline_runs` to catch "Iceberg commit succeeded but the
  metadata DB update failed" (a crash between `table.upsert()` and
  `pipeline_repo.mark_completed()`). Same category of gap as Phase 2's,
  carried forward rather than solved differently for Silver/Gold.
- Silver is current-state only (no SCD Type 2) — see [Change history / SCD
  note](#change-history--scd-note) for what a historical-state entity would
  require.
- The quality engine (`lakehouse.quality.engine`) evaluates rules in plain
  Python over `list[dict]` (via `to_pylist()`), not vectorized
  PyArrow/pandas — adequate at per-ingestion-batch scale (matches the
  PyIceberg-over-Spark choice above) but would need a vectorized rewrite
  before running over full-table Gold aggregations.
- No separate Gold reject/quarantine sink exists (unlike Silver's
  `silver-rejects/` JSONL) — a Gold record failing an ERROR-severity rule
  is excluded from the write and logged, but not persisted anywhere queryable
  beyond the `quality_results` row for that rule. Reasonable for Phase 3's
  scope (Gold quality failures should be rare if Silver already quarantined
  the source data); revisit if Gold-specific business rules start producing
  meaningful reject volume.

## Testing

```bash
make test    # or: .venv/bin/pytest
make lint     # ruff check src tests scripts
```

Unit tests (`tests/unit/`) are infrastructure-free. Integration tests
(`tests/integration/`) require the local stack (`make up`) and are
skipped automatically otherwise — each gets its own throwaway data
product/Bronze table so runs never collide with each other or with
manually-staged demo data.

Phase 3 unit tests: `test_mapping.py`, `test_contracts.py`, `test_casting.py`,
`test_deduplicator.py`, `test_quality_engine.py`, `test_event_performance.py`,
`test_pipeline_idempotency.py`, `test_pipeline_context.py`. Phase 3
integration tests (`test_phase3_pipeline.py`) additionally use the
`phase3_registration` fixture (`tests/integration/conftest.py`), which
dynamically registers a throwaway Silver entity + Gold product (isolated
`silver.event_<uuid>` / `gold.event_performance_<uuid>` tables) against the
same throwaway Bronze data product `data_product` already creates — reusing
the real `contracts/silver/event.yaml` / `contracts/gold/event-performance.yaml`
contracts (schema/rules only, not physical table identity) so pipeline
behavior under test matches production exactly. Covers: Bronze→Silver,
full Bronze→Gold, duplicate ingestion (idempotent skip), explicit
reprocessing, incremental event update (Silver upserts, Gold recomputes only
the affected event), a bad record (negative `tickets_sold`) quarantined
without failing the pipeline, two tenants with a colliding `event_id`
staying fully isolated through both Silver and Gold, and quality results
persistence.
