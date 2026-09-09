# Onboarding a brand-new test Data Product end-to-end

A repeatable runbook for wiring a brand-new Data Product all the way through
this platform's three-service pipeline — cdep (portal + catalog) →
`data-exchange-service` (control plane) → `data-lakehouse` (Bronze → Silver →
Gold) → `data-publication-service` (Gold → real OUTBOUND exchange) — starting
from "nothing exists yet" and ending with a real upload producing a real,
downloadable, Gold-derived published file.

This is genuinely worked, not aspirational: every step and every file
template below was executed against a live running stack (real Postgres,
real MinIO, real containers) while writing this doc. The concrete ids
throughout ("Test Metrics", `ds-test-metrics-789c08`, `test-metric-summary`,
etc.) are **that actual worked example** — yours will differ (ids are
randomly generated), but the shape of every step is identical.

See also: [`../docs/pipeline-job-queue-design.md`](../docs/pipeline-job-queue-design.md)
(the queue/worker this runbook exercises) and
[`../docs/exchange-service-integration.md`](../docs/exchange-service-integration.md)
(the cdep ↔ data-exchange-service integration this builds on).

## Why this is needed at all

Creating a Dataset in cdep's admin UI is sufficient to make uploads/exchanges
*work* (cdep's catalog sync mirrors it into data-exchange-service
automatically), but it is **not** sufficient to make the real
Bronze→Silver→Gold→Publish pipeline process it. That pipeline is
config/code-driven in `data-lakehouse` and `data-publication-service`, and
nothing auto-registers a new cdep Dataset there. Skipping this runbook is
exactly how a real onboarding-created dataset (`ds-test-dataset-1-233bfd` in
this environment) ended up failing at the very first pipeline stage with:

```
FileNotFoundError: No data contract configured for 'ds-test-dataset-1-233bfd':
/app/contracts/bronze/ds-test-dataset-1-233bfd.yaml
```

## Prerequisites

- The full stack running: `cdep-portal`, `data-exchange-service` (+ its own
  Postgres/MinIO), `data-lakehouse` (+ its own Postgres/MinIO), and
  `data-publication-service` (+ its own Postgres). `docker ps` should show
  all of them healthy.
- A platform superuser account in cdep (for the admin UI steps) — see
  `npm run create-superuser` in the cdep root if you don't have one.
- `DEMO_FIXTURE_PUBLISH_ENABLED=false` in cdep's `.env`/`.env.local` if you
  want uploads to *automatically* enqueue a real pipeline job (see
  `docs/pipeline-job-queue-design.md`). Otherwise you can enqueue one
  manually (step 13 below shows both).

## Naming used in the worked example

| Concept | Value |
|---|---|
| cdep DataProduct | `displayName: Test Onboarding Product` → generated id `dp-test-onboarding-product-9f3be8` |
| cdep Dataset | `displayName: Test Metrics` → generated id `ds-test-metrics-789c08` |
| Tenant used | `org-vobis-inc-265acc` / `tenant-default-60c58e` (whatever real org/tenant exists in your environment — check first, see step 0) |
| Bronze/Silver schema | `metric_id` (string, business key), `metric_label` (string), `recorded_on` (date), `metric_value` (decimal) |
| Silver entity | `test_metric` |
| Gold data product id | `test-metric-summary` (derives `metric_value_doubled = metric_value * 2`) |

---

## Step 0 — Know which org/tenant you're using

Don't assume the fictional seeded orgs (`org-acme-live-001`, etc.) exist in
your running MongoDB — they're mock-data fixtures, not guaranteed to be
present. Check what's actually there:

```js
// mongosh, or via a quick Node script against MONGODB_URI
db.organizations.find({}, { displayName: 1 })
db.tenants.find({}, { displayName: 1, organizationId: 1 })
```

Use a real, existing tenant for entitlement granting in step 3.

## Step 1 — cdep UI: create the Data Product

`/admin/data-products` → "Create Data Product":

- **Internal name**: `test-onboarding-product`
- **Display name**: `Test Onboarding Product`
- **Domain**: `Testing`
- **Owner**: `Platform Test`
- **Status**: `ACTIVE`

This writes to MongoDB's `dataProducts` collection
(`src/lib/data-product-directory.ts`) with a generated id
`dp-<slug(displayName)>-<6hex>`.

## Step 2 — cdep UI: create the Dataset under it

`/admin/data-products/<the new product's id>` → "Add Dataset" (this both
creates the Dataset and associates it with the Data Product in one step —
`createDatasetAction` in `src/app/admin/data-products/[dataProductId]/actions.ts`):

- **Internal name**: `test_metrics`
- **Display name**: `Test Metrics`
- **Domain**: `Testing`, **Owner**: `Platform Test`, **Version**: `1.0`,
  **Format**: `CSV`, **Status**: `ACTIVE`
- **Access methods**: `DOWNLOAD` (descriptive metadata only — real
  upload/download permission comes from the entitlement in step 3, not this)
- Schema rows (add via the dynamic schema editor):

  | field | type | required | description |
  |---|---|---|---|
  | `metric_id` | string | yes | Business key |
  | `metric_label` | string | yes | Human-readable label |
  | `recorded_on` | date | yes | Date the metric was recorded |
  | `metric_value` | double | no | Numeric value |

**Note the generated dataset id** shown afterward (e.g. `ds-test-metrics-789c08`)
— every later step keys off this exact string.

Creating the Dataset already best-effort-pushes it into data-exchange-service
as a data product (`syncDataProduct`, fire-and-forget) — step 4 below is the
reliable backstop, not optional busywork.

## Step 3 — cdep UI: grant the tenant an entitlement

`/admin/data-relationships` → "Grant Entitlement":

- **Tenant**: pick the org, then its tenant (from step 0)
- **Data Product**: `Test Onboarding Product`
- **Valid until**: leave blank (no expiry)

## Step 4 — Propagate to data-exchange-service and verify

```bash
cd data-exchange-service
npm run sync:cdep
```

Confirm:

```bash
docker exec -i data-exchange-service-postgres-1 psql -U exchange -d exchange \
  -c "SELECT data_product_id, name, status FROM exchange.data_products WHERE data_product_id = 'ds-test-metrics-789c08';" \
  -c "SELECT tenant_id, data_product_id, can_upload, can_download, status FROM exchange.tenant_data_product_entitlements WHERE data_product_id = 'ds-test-metrics-789c08';"
```

Both should show real rows, `can_upload`/`can_download` both `true`.

## Step 5 — data-lakehouse: Bronze contract

`data-lakehouse/contracts/bronze/ds-test-metrics-789c08.yaml` — copy
`contracts/bronze/event-data.yaml` as your template. **The filename must be
exactly `<dataset-id>.yaml`** — this is the #1 way this fails (see
Troubleshooting).

```yaml
dataProductId: ds-test-metrics-789c08
version: "1.0"
owner: platform-data-team

source:
  formats: [CSV, JSON, PARQUET]

bronze:
  namespace: bronze
  table: test_metrics

csv:
  header: true
  delimiter: ","
  encoding: UTF-8

json:
  lines: true
  encoding: UTF-8

schema:
  mode: PERMISSIVE
  fields:
    - name: metric_id
      type: string
      required: true
    - name: metric_label
      type: string
      required: true
    - name: recorded_on
      type: string
      required: true
    - name: metric_value
      type: double
      required: false

quality:
  rejectUnreadableRecords: true
```

## Step 6 — data-lakehouse: Bronze→Silver mapping

`data-lakehouse/mappings/bronze_to_silver/test-metrics-to-test-metric.yaml`
— copy `mappings/bronze_to_silver/event-data-to-event.yaml`. Fully
config-driven: column renames/type casts only, no Python required here.

```yaml
version: "1.0"
source:
  table: bronze.test_metrics
  dataProductId: ds-test-metrics-789c08
target:
  table: silver.test_metric
  entity: test_metric
keys:
  businessKey: [metric_id]
mapping:
  metric_id: { source: metric_id, type: string, required: true }
  metric_label: { source: metric_label, type: string, required: true }
  recorded_on: { source: recorded_on, type: date, required: true }
  metric_value: { source: metric_value, type: "decimal(18,2)", required: false }
lineage:
  source_exchange_id: _exchange_id
  source_ingestion_id: _ingestion_id
```

## Step 7 — data-lakehouse: Silver contract + pyarrow model

`data-lakehouse/contracts/silver/test_metric.yaml` (copy
`contracts/silver/event.yaml`) — business key, dedup rule, quality rules.
See the actual file in this repo for the full worked example.

`data-lakehouse/src/lakehouse/silver/models/test_metric.py` (copy
`silver/models/event.py`) — the pyarrow `SILVER_TEST_METRIC_SCHEMA`, business
columns plus the standard org/tenant/lineage/audit columns every silver
entity carries. See the actual file for the full worked example.

## Step 8 — data-lakehouse: Gold contract + builder (the one step that needs real code)

**Silver→Gold is not schema-only-driven.** Unlike Bronze→Silver, it requires
a small Python "builder" function — even a trivial passthrough needs one.

`data-lakehouse/contracts/gold/test-metric-summary.yaml` (copy
`contracts/gold/event-performance.yaml`) — full worked example in this repo.

`data-lakehouse/src/lakehouse/gold/products/test_metric_summary.py` (copy
`gold/products/event_performance.py`'s shape — pyarrow schema + a
`None`-safe builder function):

```python
def build_test_metric_summary(silver_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for row in silver_rows:
        records.append({
            "organization_id": row["organization_id"],
            "tenant_id": row["tenant_id"],
            "metric_id": row["metric_id"],
            "metric_label": row["metric_label"],
            "recorded_on": row["recorded_on"],
            "metric_value": row.get("metric_value"),
            "metric_value_doubled": compute_metric_value_doubled(row.get("metric_value")),
        })
    return records
```

## Step 9 — data-lakehouse: wire it into `registry.py`

Edit `data-lakehouse/src/lakehouse/pipelines/registry.py`: add one entry to
each of `SILVER_ENTITIES`, `BRONZE_TO_SILVER_PIPELINES` (keyed by your
**Bronze/dataset id**), and `SILVER_TO_GOLD_PIPELINES` (keyed by your **Gold
product id**). Import the new gold builder/schema and silver schema at the
top of the file. See this repo's actual `registry.py` for the exact worked
diff (search for `test_metric`/`test-metric-summary`).

Sanity-check the registry imports cleanly before restarting anything:

```bash
docker exec data-lakehouse-api-1 python -c "
import sys; sys.path.insert(0, '/app/src')
from lakehouse.pipelines import registry
print(list(registry.SILVER_ENTITIES.keys()))
print(list(registry.BRONZE_TO_SILVER_PIPELINES.keys()))
print(list(registry.SILVER_TO_GOLD_PIPELINES.keys()))
"
```

## Step 10 — data-lakehouse: seed the Gold product row and restart

`GET /internal/v1/data-products` (backs cdep's "Publish Gold Product" panel)
reads a real Postgres table, `lakehouse.data_products` — **not** driven by
the `contracts/gold/*.yaml` file. Add a new numbered SQL file for
reproducibility on a fresh volume, matching `sql/002_pipeline_metadata.sql`'s
seed pattern:

```sql
-- data-lakehouse/sql/003_test_metric_summary_seed.sql
INSERT INTO lakehouse.data_products (
    data_product_id, display_name, version, gold_table, owner, description, status
) VALUES (
    'test-metric-summary', 'Test Metric Summary', '1.0', 'gold.test_metric_summary',
    'Platform Test', 'Synthetic test Gold Data Product.', 'ACTIVE'
) ON CONFLICT (data_product_id) DO NOTHING;
```

The mounted `sql/*.sql` files only auto-apply on a **fresh** Postgres volume
(`docker-entrypoint-initdb.d` semantics). On an already-running volume, apply
by hand:

```bash
docker exec -i data-lakehouse-postgres-1 psql -U lakehouse -d lakehouse < sql/003_test_metric_summary_seed.sql
```

Then restart so the new `registry.py`/Python modules load (no reload watcher
configured):

```bash
docker restart data-lakehouse-api-1 data-lakehouse-ingestion-1
```

Verify:

```bash
curl -s -H "x-internal-api-key: <your LAKEHOUSE_INTERNAL_API_KEY>" \
  http://localhost:8090/internal/v1/data-products
```

should list your new Gold product.

## Step 11 — data-exchange-service: register the Gold product too (easy to miss)

**This step is not obvious from any single doc and was only discovered by
actually running the pipeline end-to-end.** The final PUBLISH stage creates
an OUTBOUND exchange keyed by the **Gold** product id
(`test-metric-summary`), via data-exchange-service's own
`/internal/v1/outbound-publications`. That endpoint checks
`exchange.data_products`/`exchange.tenant_data_product_entitlements` for
`test-metric-summary` — a completely separate row from the
`ds-test-metrics-789c08` (Bronze/dataset-level) row created in step 4, and
one cdep's catalog sync has no reason to ever create (cdep doesn't know Gold
product ids exist). Skipping this step fails at the PUBLISH stage with:

```
Exchange Service returned 404 for POST /internal/v1/outbound-publications:
{"error":{"code":"DATA_PRODUCT_NOT_FOUND","message":"The requested data product was not found."}}
```

Fix — register it directly (there is no UI for this; it's a
data-exchange-service/lakehouse-side administrative concept, not a cdep
catalog concept):

```bash
docker exec -i data-exchange-service-postgres-1 psql -U exchange -d exchange <<'EOF'
INSERT INTO exchange.data_products (data_product_id, name, description, direction, current_schema_version, status)
VALUES ('test-metric-summary', 'Test Metric Summary', 'Synthetic Gold data product.', 'OUTBOUND', '1.0', 'ACTIVE')
ON CONFLICT (data_product_id) DO NOTHING;

INSERT INTO exchange.tenant_data_product_entitlements (tenant_id, data_product_id, can_upload, can_download, status)
VALUES ('<your tenant id>', 'test-metric-summary', false, true, 'ACTIVE')
ON CONFLICT (tenant_id, data_product_id) DO NOTHING;
EOF
```

## Step 12 — data-publication-service: publication contract (no restart needed)

`data-publication-service/contracts/products/test-metric-summary.yaml` —
`dataProduct.id` must exactly match the Gold product id from step 8/9.
Copy `contracts/products/event-performance.yaml`. `masking: {}` is the
correct minimal config for a product with no PII fields. No restart is
needed: the loader reads a *new* product id fresh (only previously-read ids
are `lru_cache`d).

```yaml
dataProduct:
  id: test-metric-summary
  name: Test Metric Summary
  version: "1.0"
  owner: Platform Test
source:
  table: gold.test_metric_summary
grain: [metric_id]
tenantScope: { organizationColumn: organization_id, tenantColumn: tenant_id }
publishedSchema:
  - { name: metric_id, source: metric_id, type: string, required: true }
  - { name: metric_label, source: metric_label, type: string, required: true }
  - { name: recorded_on, source: recorded_on, type: date, required: true }
  - { name: metric_value, source: metric_value, type: "decimal(18,2)", required: false }
  - { name: metric_value_doubled, source: metric_value_doubled, type: "decimal(18,2)", required: false }
formats: [PARQUET, CSV]
defaultFormat: PARQUET
publication:
  filenamePattern: "test-metric-summary-{date}-{publicationId}"
  compression: { parquet: snappy, csv: gzip }
  expirationHours: 168
quality: { verifySchema: true, verifyRecordCount: true, requireNonEmpty: true, enforceGrain: true }
masking: {}
```

## Step 13 — End-to-end test

**Via the UI**: log in as the tenant user, go to Upload Data, pick "Test
Metrics", upload a CSV with the 4 columns from step 1's schema. If
`DEMO_FIXTURE_PUBLISH_ENABLED=false`, this automatically enqueues a real
pipeline job.

**Via curl** (what was actually used to verify this runbook — see
data-exchange-service's own README "Sample requests" for the full 6-step
sequence: initiate → PUT bytes → complete → enqueue):

```bash
DEV_TOKEN=$(node -e "console.log(Buffer.from(JSON.stringify({sub:'usr-test',organization_id:'<org>',active_tenant_id:'<tenant>',role:'CUSTOMER_ADMIN'})).toString('base64url'))")

INIT=$(curl -s -X POST http://localhost:8080/v1/uploads -H "Authorization: Bearer $DEV_TOKEN" -H "Content-Type: application/json" \
  -d '{"dataProductId":"ds-test-metrics-789c08","filename":"test.csv","contentType":"text/csv","sizeBytes":<real byte count>,"schemaVersion":"1.0"}')
# PUT your CSV to $INIT.upload.url, then:
curl -s -X POST "http://localhost:8080/v1/uploads/<exchangeId>/complete" -H "Authorization: Bearer $DEV_TOKEN"

curl -s -X POST http://localhost:8080/internal/v1/pipeline-jobs -H "x-internal-api-key: <key>" -H "Content-Type: application/json" \
  -d '{"organizationId":"<org>","tenantId":"<tenant>","dataProductId":"ds-test-metrics-789c08","exchangeId":"<exchangeId>"}'
```

Watch it (worker polls every `PIPELINE_WORKER_POLL_INTERVAL_MS`, default 15s):

```bash
watch -n5 "docker exec -i data-exchange-service-postgres-1 psql -U exchange -d exchange -t -c \\
  \"SELECT status, current_stage, outbound_exchange_id, error_message FROM exchange.pipeline_jobs ORDER BY created_at DESC LIMIT 1;\""
```

Expect `PENDING` → `SUCCEEDED` with a populated `outbound_exchange_id`, having
passed through `INGEST`/`BRONZE_TO_SILVER`/`SILVER_TO_GOLD`/`PUBLISH` as
`current_stage` along the way. Then fetch the real result:

```bash
curl -s -X POST "http://localhost:8080/v1/downloads/<outbound_exchange_id>/url" -H "Authorization: Bearer $DEV_TOKEN"
# -> real signed MinIO URL; GET it for the real Parquet/CSV bytes, including your derived column.
```

---

## Troubleshooting (real failures hit while building this runbook)

**`FileNotFoundError: No data contract configured for '<id>'`** — the Bronze
contract YAML is missing or misnamed. It must be exactly
`data-lakehouse/contracts/bronze/<data-product-id>.yaml`. This is the
INGEST-stage failure that motivated writing this whole runbook.

**`{"error_code":"NOT_CONFIGURED", ...}` or a bare `Internal Server Error`**
— check the *target* service's own container logs
(`docker logs <service>-api-1`) for the real Python traceback. The HTTP
client layer here can't recover a structured error from an unhandled 500
(FastAPI's default error handler returns plain text, not JSON) — the
`pipeline_jobs.error_message` will just say "Internal Server Error", which
tells you *that* something broke but not *what*. Always go to the source
container's logs.

**`No Silver->Gold pipeline registered for product_id='<bronze-id>'`** —
means something is passing the *Bronze* data product id where a *Gold*
product id (or nothing) was expected on `POST
/internal/v1/pipeline-runs/silver-to-gold`. Omitting `product_id` entirely
lets that endpoint resolve the Gold product(s) itself from
`BRONZE_TO_SILVER_PIPELINES[<bronze-id>].gold_products` via the
`silver_run_id` — that's the correct way to call it when you only know the
Bronze id (which is all the pipeline worker ever knows).

**`DATA_PRODUCT_NOT_FOUND` on `POST /internal/v1/outbound-publications`** —
see step 11. The Gold product id needs its own row in
data-exchange-service's `exchange.data_products` +
`tenant_data_product_entitlements`, separate from the Bronze/dataset-level
row created via cdep's catalog sync.

**Contract/mapping YAML edits not taking effect** — bronze contracts are
read fresh every call (no restart needed). Bronze→Silver **mapping** YAML is
`lru_cache`d *per mapping id* in the running process — a brand-new mapping
id needs no restart, but editing an *already-read* mapping file does.
`registry.py` and anything under `gold/products/`/`silver/models/` are
imported Python modules — always need `docker restart <api> <ingestion>`
after editing.
