-- One row per registered version of a Data Product. Phase 5 allows exactly
-- one canonical ACTIVE version per data_product_id (enforced by a partial
-- unique index in 012_indexes.sql), matching spec §10: "Do NOT silently
-- allow multiple ACTIVE versions unless the design explicitly supports it."
-- Parallel major versions (e.g. both 1.x and 2.x ACTIVE at once) are a
-- deliberate Phase 6+ extension: lift the partial-unique constraint and add
-- a "canonical major version" concept alongside current_active_version.
CREATE TABLE catalog.data_product_versions (
    data_product_version_id  VARCHAR(64)  PRIMARY KEY,

    data_product_id           VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),

    version                    VARCHAR(32)  NOT NULL,

    lifecycle_status            VARCHAR(32)  NOT NULL DEFAULT 'DRAFT',

    contract_version             VARCHAR(32)  NOT NULL,
    schema_version                VARCHAR(32)  NOT NULL,

    description                    TEXT,
    grain_definition                TEXT,

    breaking_change                  BOOLEAN     NOT NULL DEFAULT false,

    effective_from                    TIMESTAMPTZ,
    deprecated_at                      TIMESTAMPTZ,
    retired_at                          TIMESTAMPTZ,

    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT product_versions_unique UNIQUE (data_product_id, version),
    CONSTRAINT product_versions_lifecycle_chk CHECK (
        lifecycle_status IN ('DRAFT', 'BETA', 'ACTIVE', 'DEPRECATED', 'RETIRED')
    )
);
