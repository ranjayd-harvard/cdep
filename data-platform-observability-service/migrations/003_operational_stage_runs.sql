-- One row per normalized-stage attempt within an execution (spec section 6).
-- The full internal richness of a sibling's own state lives in that
-- sibling's own database; this table only ever stores the normalized
-- projection needed for timeline/SLA/health/alerting.
CREATE TABLE operational_stage_runs (
    stage_run_id VARCHAR(64) PRIMARY KEY,
    execution_id VARCHAR(64) NOT NULL REFERENCES operational_executions (execution_id),

    stage VARCHAR(30) NOT NULL CHECK (
        stage IN (
            'EXCHANGE_RECEIVED', 'EXCHANGE_VALIDATION', 'BRONZE_INGESTION',
            'SILVER_TRANSFORMATION', 'GOLD_PRODUCT_BUILD', 'QUALITY_VALIDATION',
            'PUBLICATION', 'OUTBOUND_EXCHANGE', 'FILE_DELIVERY', 'API_DELIVERY'
        )
    ),
    status VARCHAR(20) NOT NULL CHECK (
        status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'BLOCKED', 'LATE', 'CANCELLED', 'UNKNOWN')
    ),

    source_service VARCHAR(64) NOT NULL,
    source_entity_id VARCHAR(128),

    attempt_number INTEGER NOT NULL DEFAULT 1,

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms BIGINT,

    error_category VARCHAR(64),
    error_code VARCHAR(64),
    error_message TEXT,

    -- Contractually never customer row-level data (spec section 6) —
    -- normalizers are the sole enforcement point; only operationally-safe
    -- fields (record counts, byte counts, quality summaries) belong here.
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (execution_id, stage, attempt_number)
);

CREATE INDEX ix_operational_stage_runs_execution ON operational_stage_runs (execution_id, stage);
