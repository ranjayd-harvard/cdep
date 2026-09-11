-- Dimensional metric rows (spec section 14/16). Deliberately no
-- execution_id / request_id / trace_id column — high-cardinality
-- identifiers never become metric rows here, only aggregatable dimensions
-- (data_product_id, product_version, organization_id, tenant_id, stage,
-- delivery_method, time window). Per-execution detail lives in
-- operational_stage_runs/operational_events instead.
CREATE TABLE operational_metrics (
    metric_id BIGSERIAL PRIMARY KEY,

    metric_name VARCHAR(64) NOT NULL,

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    data_product_id VARCHAR(128) NOT NULL,
    product_version VARCHAR(32) NOT NULL,

    stage VARCHAR(30),
    delivery_method VARCHAR(20) CHECK (delivery_method IS NULL OR delivery_method IN ('FILE', 'API')),

    time_window_start TIMESTAMPTZ NOT NULL,
    time_window_end TIMESTAMPTZ NOT NULL,

    value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(32),

    -- Low-cardinality extra dimensions only (e.g. {"layer":"GOLD"}) — never
    -- an execution/request/trace id.
    dimensions_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_operational_metrics_lookup ON operational_metrics (metric_name, data_product_id, product_version, time_window_start DESC);
CREATE INDEX ix_operational_metrics_tenant ON operational_metrics (tenant_id, time_window_start DESC);
