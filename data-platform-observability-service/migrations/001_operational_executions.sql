-- The correlation root (Phase 9 spec section 3/6). One row per logical
-- execution of a Data Product for a tenant. Observability owns this row —
-- it is a read-model projection, never a second copy of any sibling's
-- authoritative workflow state (AGENTS.md / Phase 9 non-negotiable
-- architecture principle).
CREATE TABLE operational_executions (
    execution_id VARCHAR(64) PRIMARY KEY,

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,

    -- Human/contract-assigned slugs, not generated ids — same shape as
    -- catalog/subscription/scheduling/publication/lakehouse.
    data_product_id VARCHAR(128) NOT NULL,
    product_version VARCHAR(32) NOT NULL,

    -- Nullable: an ad hoc execution (no scheduler involved) naturally omits
    -- these rather than being modeled as a special case (plan section 5).
    subscription_id VARCHAR(64),
    scheduled_run_id VARCHAR(64),

    -- Full correlation chain (spec section 3). Each is nullable because an
    -- execution is created from whichever event arrives first and filled in
    -- incrementally as later stages complete.
    inbound_exchange_id VARCHAR(64),
    ingestion_id VARCHAR(64),
    silver_pipeline_run_id VARCHAR(64),
    gold_pipeline_run_id VARCHAR(64),
    publication_id VARCHAR(64),
    outbound_exchange_id VARCHAR(64),
    delivery_request_id VARCHAR(64),
    api_request_id VARCHAR(64),

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    current_stage VARCHAR(30) CHECK (
        current_stage IS NULL OR current_stage IN (
            'EXCHANGE_RECEIVED', 'EXCHANGE_VALIDATION', 'BRONZE_INGESTION',
            'SILVER_TRANSFORMATION', 'GOLD_PRODUCT_BUILD', 'QUALITY_VALIDATION',
            'PUBLICATION', 'OUTBOUND_EXCHANGE', 'FILE_DELIVERY', 'API_DELIVERY'
        )
    ),
    overall_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
        overall_status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'BLOCKED', 'LATE', 'CANCELLED', 'UNKNOWN')
    ),

    technical_sla_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN' CHECK (
        technical_sla_status IN ('PASS', 'FAIL', 'AT_RISK', 'NOT_APPLICABLE', 'UNKNOWN')
    ),
    business_sla_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN' CHECK (
        business_sla_status IN ('PASS', 'FAIL', 'AT_RISK', 'NOT_APPLICABLE', 'UNKNOWN')
    ),
    health_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN' CHECK (
        health_status IN ('HEALTHY', 'DEGRADED', 'AT_RISK', 'UNHEALTHY', 'UNKNOWN')
    ),

    -- Best-effort trace correlation id carried across the whole chain
    -- (spec section 30) — independent of whether any sibling adopts full
    -- distributed tracing.
    correlation_id VARCHAR(64),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
