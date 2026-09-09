-- Declared SLA for a version. Runtime SLA MONITORING is out of scope for
-- Phase 5 (spec §22) and is planned for Phase 9.
CREATE TABLE catalog.sla_policies (
    sla_policy_id                        VARCHAR(64) PRIMARY KEY,

    data_product_version_id               VARCHAR(64) NOT NULL UNIQUE
        REFERENCES catalog.data_product_versions (data_product_version_id),

    freshness_minutes                       INTEGER,
    availability_target_percent              NUMERIC(5, 2),

    delivery_deadline_expression               VARCHAR(255),
    maximum_publication_latency_minutes          INTEGER,

    created_at                                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
