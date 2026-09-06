-- Operational ingestion metadata store. This is intentionally a *separate*
-- schema from the Iceberg catalog's own metadata tables (schema
-- iceberg_catalog, managed by PyIceberg's SQL catalog) — see
-- src/lakehouse/catalog/catalog.py. Ingestion state must never live only in
-- application logs (AGENTS.md section 15).
--
-- Mounted into the Postgres container's /docker-entrypoint-initdb.d/ so it
-- runs automatically on first `docker compose up` (fresh volume only).

CREATE SCHEMA IF NOT EXISTS lakehouse;

CREATE TABLE IF NOT EXISTS lakehouse.ingestion_runs (
    ingestion_id            TEXT PRIMARY KEY,
    exchange_id             TEXT NOT NULL,

    organization_id         TEXT NOT NULL,
    tenant_id               TEXT NOT NULL,

    data_product_id         TEXT NOT NULL,
    schema_version          TEXT NOT NULL,

    source_filename         TEXT NOT NULL,
    source_format           TEXT NOT NULL,
    source_checksum         TEXT,

    bronze_table            TEXT NOT NULL,

    status                  TEXT NOT NULL,

    started_at              TIMESTAMPTZ NOT NULL,
    completed_at            TIMESTAMPTZ,

    source_record_count     BIGINT,
    bronze_record_count     BIGINT,
    rejected_record_count   BIGINT,

    error_code              TEXT,
    error_message           TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency lookups: "has this exchange already been successfully
-- ingested for this data product / schema version?"
CREATE INDEX IF NOT EXISTS ix_ingestion_runs_exchange
    ON lakehouse.ingestion_runs (exchange_id, data_product_id, schema_version, status);

-- Tenant-scoped operational queries.
CREATE INDEX IF NOT EXISTS ix_ingestion_runs_tenant
    ON lakehouse.ingestion_runs (organization_id, tenant_id, created_at DESC);
