-- Phase 3 pipeline metadata: Bronze->Silver and Silver->Gold transformation
-- runs, their event trail, data quality results, lineage edges, and the
-- lightweight Data Product registry. Same `lakehouse` schema as
-- 001_ingestion_runs.sql -- deliberately not a new schema, these are all
-- "lakehouse operational metadata".
--
-- Mounted into the Postgres container's /docker-entrypoint-initdb.d/ so it
-- runs automatically on first `docker compose up` (fresh volume only). For
-- an already-initialized volume, apply by hand (see README "Applying a new
-- SQL migration").

CREATE SCHEMA IF NOT EXISTS lakehouse;

-- ---------------------------------------------------------------------------
-- pipeline_runs: one row per Bronze->Silver or Silver->Gold execution.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lakehouse.pipeline_runs (
    pipeline_run_id         TEXT PRIMARY KEY,

    pipeline_name           TEXT NOT NULL,
    pipeline_type           TEXT NOT NULL, -- BRONZE_TO_SILVER | SILVER_TO_GOLD

    organization_id         TEXT NOT NULL,
    tenant_id               TEXT NOT NULL,

    source_table            TEXT NOT NULL,
    target_table            TEXT NOT NULL,

    source_exchange_id      TEXT,
    source_ingestion_id     TEXT,
    source_pipeline_run_id  TEXT, -- for SILVER_TO_GOLD: the Bronze->Silver run it reads from

    data_product_id         TEXT,

    pipeline_version        TEXT NOT NULL,
    contract_version        TEXT NOT NULL,
    mapping_version         TEXT,

    source_snapshot_id      TEXT,
    target_snapshot_id      TEXT,

    status                  TEXT NOT NULL,

    input_record_count      BIGINT,
    output_record_count     BIGINT,
    rejected_record_count   BIGINT,

    started_at              TIMESTAMPTZ NOT NULL,
    completed_at            TIMESTAMPTZ,

    error_code              TEXT,
    error_message           TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency lookups: "has this ingestion/source run already been
-- successfully processed by this pipeline at this version?"
CREATE INDEX IF NOT EXISTS ix_pipeline_runs_idempotency
    ON lakehouse.pipeline_runs (
        pipeline_name, organization_id, tenant_id,
        source_ingestion_id, source_pipeline_run_id,
        pipeline_version, contract_version, mapping_version, status
    );

CREATE INDEX IF NOT EXISTS ix_pipeline_runs_tenant
    ON lakehouse.pipeline_runs (organization_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_pipeline_runs_source_ingestion
    ON lakehouse.pipeline_runs (source_ingestion_id);

CREATE INDEX IF NOT EXISTS ix_pipeline_runs_source_pipeline_run
    ON lakehouse.pipeline_runs (source_pipeline_run_id);

-- ---------------------------------------------------------------------------
-- pipeline_events: append-only event trail for one pipeline_run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lakehouse.pipeline_events (
    pipeline_event_id       BIGSERIAL PRIMARY KEY,
    pipeline_run_id         TEXT NOT NULL REFERENCES lakehouse.pipeline_runs (pipeline_run_id),
    event_type              TEXT NOT NULL,
    event_data              JSONB,
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pipeline_events_run
    ON lakehouse.pipeline_events (pipeline_run_id, occurred_at);

-- ---------------------------------------------------------------------------
-- quality_results: one row per (pipeline_run, rule) evaluation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lakehouse.quality_results (
    quality_result_id       BIGSERIAL PRIMARY KEY,
    pipeline_run_id         TEXT NOT NULL REFERENCES lakehouse.pipeline_runs (pipeline_run_id),

    organization_id         TEXT NOT NULL,
    tenant_id               TEXT NOT NULL,

    layer                   TEXT NOT NULL, -- SILVER | GOLD
    table_name               TEXT NOT NULL,
    rule_name                TEXT NOT NULL,

    severity                 TEXT NOT NULL, -- INFO | WARNING | ERROR

    total_count               BIGINT NOT NULL,
    failed_count               BIGINT NOT NULL,
    failure_percentage         DOUBLE PRECISION NOT NULL,

    passed                    BOOLEAN NOT NULL,

    evaluated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_quality_results_run
    ON lakehouse.quality_results (pipeline_run_id);

CREATE INDEX IF NOT EXISTS ix_quality_results_table
    ON lakehouse.quality_results (table_name, evaluated_at DESC);

-- ---------------------------------------------------------------------------
-- lineage_edges: coarse snapshot-to-snapshot lineage graph.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lakehouse.lineage_edges (
    lineage_edge_id          BIGSERIAL PRIMARY KEY,

    source_type              TEXT NOT NULL, -- e.g. bronze_table, silver_table, exchange, ingestion
    source_identifier        TEXT NOT NULL,

    target_type              TEXT NOT NULL, -- e.g. silver_table, gold_table
    target_identifier        TEXT NOT NULL,

    pipeline_run_id          TEXT REFERENCES lakehouse.pipeline_runs (pipeline_run_id),

    organization_id          TEXT NOT NULL,
    tenant_id                TEXT NOT NULL,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_lineage_edges_target
    ON lakehouse.lineage_edges (target_type, target_identifier);

CREATE INDEX IF NOT EXISTS ix_lineage_edges_source
    ON lakehouse.lineage_edges (source_type, source_identifier);

CREATE INDEX IF NOT EXISTS ix_lineage_edges_run
    ON lakehouse.lineage_edges (pipeline_run_id);

-- ---------------------------------------------------------------------------
-- data_products: lightweight operational Data Product registry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lakehouse.data_products (
    data_product_id          TEXT PRIMARY KEY,
    display_name             TEXT NOT NULL,

    version                  TEXT NOT NULL,
    gold_table                TEXT NOT NULL,

    owner                     TEXT NOT NULL,
    description               TEXT,

    status                    TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | ACTIVE | DEPRECATED

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO lakehouse.data_products (
    data_product_id, display_name, version, gold_table, owner, description, status
) VALUES (
    'event-performance', 'Event Performance', '1.0', 'gold.event_performance',
    'Event Analytics', 'Business-ready event performance data for entitled consumers.', 'ACTIVE'
)
ON CONFLICT (data_product_id) DO NOTHING;
