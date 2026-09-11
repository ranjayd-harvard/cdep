-- Alert lifecycle (spec sections 21-23). dedup_key is the deterministic
-- (tenant + product + version + alert_type + execution/window) key from
-- plan section 8/domain/alerting/dedup-key.ts — its UNIQUE constraint is
-- what turns a repeated rule-fire into an UPSERT/reopen instead of a
-- duplicate row, so one broken execution can never fan out into hundreds
-- of alerts.
CREATE TABLE alerts (
    alert_id VARCHAR(64) PRIMARY KEY,
    dedup_key VARCHAR(300) NOT NULL UNIQUE,

    alert_type VARCHAR(64) NOT NULL CHECK (
        alert_type IN (
            'INGESTION_FAILED', 'PIPELINE_FAILED', 'PIPELINE_STUCK', 'QUALITY_THRESHOLD_BREACHED',
            'PUBLICATION_FAILED', 'DELIVERY_LATE', 'API_AVAILABILITY_BELOW_THRESHOLD',
            'FRESHNESS_SLA_BREACHED', 'REPEATED_RETRIES', 'NO_DATA_RECEIVED', 'BUSINESS_SLA_BREACHED'
        )
    ),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),

    state VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED')),

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    data_product_id VARCHAR(128) NOT NULL,
    product_version VARCHAR(32) NOT NULL,
    execution_id VARCHAR(64) REFERENCES operational_executions (execution_id),

    title VARCHAR(255) NOT NULL,
    description TEXT,

    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(128),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(128),
    suppressed_until TIMESTAMPTZ,

    incident_id VARCHAR(64),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_alerts_state ON alerts (state, tenant_id, data_product_id);
CREATE INDEX ix_alerts_execution ON alerts (execution_id);
