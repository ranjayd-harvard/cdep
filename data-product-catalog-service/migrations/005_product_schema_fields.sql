-- The externally-published schema for one Data Product Version. This is
-- NOT a mirror of Gold's physical columns (spec §33/§63): only fields
-- explicitly declared in the contract are persisted here, and internal
-- Gold-only columns (organization_id, tenant_id, _gold_pipeline_run_id, ...)
-- never appear unless the contract lists them.
CREATE TABLE catalog.product_schema_fields (
    schema_field_id            VARCHAR(64)  PRIMARY KEY,

    data_product_version_id     VARCHAR(64)  NOT NULL REFERENCES catalog.data_product_versions (data_product_version_id),

    ordinal                       INTEGER      NOT NULL,

    field_name                     VARCHAR(255) NOT NULL,
    data_type                       VARCHAR(64)  NOT NULL,
    nullable                         BOOLEAN      NOT NULL,

    description                       TEXT,
    classification                     VARCHAR(32),

    business_key                        BOOLEAN NOT NULL DEFAULT false,
    grain_key                            BOOLEAN NOT NULL DEFAULT false,
    customer_visible                      BOOLEAN NOT NULL DEFAULT true,

    created_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT product_schema_fields_unique UNIQUE (data_product_version_id, field_name),
    CONSTRAINT product_schema_fields_classification_chk CHECK (
        classification IS NULL OR classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')
    )
);
