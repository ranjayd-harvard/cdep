-- Declared quality expectations for a version. Actual runtime quality
-- MEASUREMENTS remain in the Lakehouse/observability systems (spec §21) —
-- this table stores policy, not results.
CREATE TABLE catalog.quality_policies (
    quality_policy_id           VARCHAR(64) PRIMARY KEY,

    data_product_version_id      VARCHAR(64) NOT NULL UNIQUE
        REFERENCES catalog.data_product_versions (data_product_version_id),

    minimum_completeness_percent  NUMERIC(5, 2),
    maximum_invalid_percent        NUMERIC(5, 2),

    grain_unique_required            BOOLEAN NOT NULL DEFAULT false,

    rules                              JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                           TIMESTAMPTZ NOT NULL DEFAULT now()
);
