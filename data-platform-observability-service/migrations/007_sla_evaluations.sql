-- One evaluation row per (execution, sla_definition) pair (spec section 13).
-- Never overwritten — historical SLA performance is queried directly from
-- this table, including across a later recovery (spec section 40's "do not
-- erase history when the system recovers").
CREATE TABLE sla_evaluations (
    sla_evaluation_id VARCHAR(64) PRIMARY KEY,

    execution_id VARCHAR(64) NOT NULL REFERENCES operational_executions (execution_id),
    sla_definition_id VARCHAR(64) NOT NULL REFERENCES sla_definitions (sla_definition_id),

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    data_product_id VARCHAR(128) NOT NULL,
    product_version VARCHAR(32) NOT NULL,

    sla_type VARCHAR(20) NOT NULL CHECK (sla_type IN ('TECHNICAL', 'BUSINESS', 'STAGE_TARGET')),
    stage VARCHAR(30),

    status VARCHAR(20) NOT NULL CHECK (status IN ('PASS', 'FAIL', 'AT_RISK', 'NOT_APPLICABLE', 'UNKNOWN')),

    target_value JSONB NOT NULL,
    actual_value JSONB NOT NULL,
    breach_duration_seconds INTEGER,

    evaluation_window_start TIMESTAMPTZ,
    evaluation_window_end TIMESTAMPTZ,

    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (execution_id, sla_definition_id)
);

CREATE INDEX ix_sla_evaluations_execution ON sla_evaluations (execution_id);
CREATE INDEX ix_sla_evaluations_active_breaches ON sla_evaluations (status, data_product_id, tenant_id) WHERE status = 'FAIL';
