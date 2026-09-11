-- One row per reconciliation pass per adapter (spec section 8). Records
-- what drift was found/repaired against the authoritative sibling — the
-- reconciler itself never mutates any sibling's state, only this service's
-- own read-model (plan section 4).
CREATE TABLE reconciliation_runs (
    reconciliation_run_id VARCHAR(64) PRIMARY KEY,

    adapter_name VARCHAR(64) NOT NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),

    records_scanned INTEGER NOT NULL DEFAULT 0,
    drift_detected_count INTEGER NOT NULL DEFAULT 0,
    drift_repaired_count INTEGER NOT NULL DEFAULT 0,

    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_reconciliation_runs_adapter ON reconciliation_runs (adapter_name, started_at DESC);
