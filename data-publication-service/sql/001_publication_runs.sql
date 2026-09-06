CREATE SCHEMA IF NOT EXISTS publication;

-- ---------------------------------------------------------------------------
-- publication_runs: one row per attempted GoldReady -> Outbound publication.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publication.publication_runs (
    publication_id              TEXT PRIMARY KEY,

    organization_id              TEXT NOT NULL,
    tenant_id                    TEXT NOT NULL,

    data_product_id              TEXT NOT NULL,
    product_version              TEXT NOT NULL,

    source_gold_table            TEXT NOT NULL,
    source_gold_snapshot_id      TEXT,

    source_pipeline_run_id       TEXT,

    requested_format             TEXT,

    contract_version             TEXT,
    schema_fingerprint           TEXT,

    status                       TEXT NOT NULL,

    input_record_count           BIGINT,
    output_record_count          BIGINT,

    artifact_count                BIGINT,

    outbound_exchange_id         TEXT,

    -- Idempotency identity (AGENTS.md section 16): organization_id +
    -- tenant_id + data_product_id + product_version + gold_snapshot_id +
    -- requested_format + contract_version must be unique for a normal
    -- (non --republish) publication attempt.
    idempotency_key               TEXT,

    started_at                    TIMESTAMPTZ,
    completed_at                  TIMESTAMPTZ,

    error_code                    TEXT,
    error_message                 TEXT,

    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
