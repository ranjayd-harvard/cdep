-- ---------------------------------------------------------------------------
-- api_serving.projection_runs: one row per attempted Gold -> Serving
-- refresh (spec §8.4). `checkpoint` records the incremental-refresh cursor
-- ({"type": "timestamp", "value": "<iso ts>"} for event-performance, since
-- Gold's `_updated_at` column is real -- see the projector for why this is
-- not faked CDC).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_serving.projection_runs (
    projection_run_id           TEXT PRIMARY KEY,

    product_id                  TEXT NOT NULL,
    product_version             TEXT NOT NULL,

    source_snapshot             TEXT,
    serving_snapshot_id         TEXT,

    refresh_type                TEXT NOT NULL CHECK (refresh_type IN ('FULL', 'INCREMENTAL')),
    status                      TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),

    rows_read                   BIGINT,
    rows_written                BIGINT,

    checkpoint                  JSONB,

    error_code                  TEXT,
    error_message                TEXT,

    started_at                  TIMESTAMPTZ NOT NULL,
    completed_at                 TIMESTAMPTZ,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
