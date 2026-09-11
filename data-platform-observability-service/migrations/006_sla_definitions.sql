-- Cached/materialized SLA definitions (spec sections 10-13). Catalog
-- remains the source of truth for declared SLA (catalog.sla_policies) —
-- this table is an append-and-supersede cache, never a competing
-- definition. catalog_reference is NULL for Phase-9-owned STAGE_TARGET
-- rows (catalog declares nothing per-stage) and holds catalog's
-- sla_policy_id otherwise. Never UPDATEd in place — a changed declaration
-- closes the prior row (effective_to) and inserts a new one, preserving
-- full history and explicitly supporting multiple concurrent
-- product/version SLAs ahead of Phase 10 (spec section 47).
CREATE TABLE sla_definitions (
    sla_definition_id VARCHAR(64) PRIMARY KEY,

    data_product_id VARCHAR(128) NOT NULL,
    product_version VARCHAR(32) NOT NULL,

    sla_type VARCHAR(20) NOT NULL CHECK (sla_type IN ('TECHNICAL', 'BUSINESS', 'STAGE_TARGET')),
    -- Only populated for sla_type = 'STAGE_TARGET'.
    stage VARCHAR(30) CHECK (
        stage IS NULL OR stage IN (
            'EXCHANGE_RECEIVED', 'EXCHANGE_VALIDATION', 'BRONZE_INGESTION',
            'SILVER_TRANSFORMATION', 'GOLD_PRODUCT_BUILD', 'QUALITY_VALIDATION',
            'PUBLICATION', 'OUTBOUND_EXCHANGE', 'FILE_DELIVERY', 'API_DELIVERY'
        )
    ),

    catalog_reference VARCHAR(64),

    -- Shape depends on sla_type: BUSINESS -> {deliveryDeadlineExpression,
    -- availabilityTargetPercent}; TECHNICAL -> {freshnessMinutes,
    -- maximumPublicationLatencyMinutes}; STAGE_TARGET -> {targetMinutes}.
    target JSONB NOT NULL,

    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_sla_definitions_lookup ON sla_definitions (data_product_id, product_version, sla_type, effective_from DESC);
