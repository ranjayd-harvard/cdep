# serving-projection-service

Phase 8 Gold -> API Serving Store projection layer. Reads
`gold.event_performance` from the same Iceberg catalog data-lakehouse and
data-publication-service already use, projects only the Catalog-published
fields into a tenant-isolated Postgres serving table
(`api_serving.event_performance_events`), and never serves that data to a
customer itself -- that's `data-product-api-service`'s job, reading the
same Postgres directly.

## Why a separate service

Mirrors `data-publication-service`'s architecture (Python + PyIceberg,
reading the identical catalog/warehouse) rather than reimplementing Gold
access in Node -- see the root `AGENTS.md`/Phase 8 plan for the full
rationale. The two services share no code (separate deployable projects,
no monorepo tooling in this repo), only the same external Postgres-backed
Iceberg catalog + MinIO warehouse.

## Local development

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env   # already points at localhost:5440 / :5434 / :9010
.venv/bin/python scripts/run_migrations.py
.venv/bin/python scripts/seed_demo_gold.py --mode initial
.venv/bin/python scripts/run_projection.py --refresh-type FULL
.venv/bin/python -m pytest
```

## Docker

```bash
docker compose up -d --build postgres api
docker compose run --rm runner python scripts/run_migrations.py
docker compose run --rm runner python scripts/seed_demo_gold.py --mode initial
docker compose run --rm runner python scripts/run_projection.py --refresh-type FULL
```

`api` (host port 8096) is an ops-only internal surface (`/health/live`,
`/health/ready`, `GET/POST /internal/v1/projection-runs`) gated by
`x-internal-api-key`. It is never called by `data-product-api-service`,
which reads Postgres directly.

## Incremental refresh demo (spec §8.19)

```bash
.venv/bin/python scripts/seed_demo_gold.py --mode update-tenant-a
.venv/bin/python scripts/run_projection.py --refresh-type INCREMENTAL
```

Only Tenant A's `EVT1001` row changes; Tenant B's is untouched, and the
prior successful full-refresh snapshot stays servable throughout (see
`serving_store/repository.py::swap_staging_into_live`).
