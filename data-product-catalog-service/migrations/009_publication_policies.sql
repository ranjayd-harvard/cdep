-- Policy the Publication Service should eventually resolve from the Catalog
-- instead of duplicating in local YAML (spec §24/§51).
CREATE TABLE catalog.publication_policies (
    publication_policy_id      VARCHAR(64) PRIMARY KEY,

    data_product_version_id     VARCHAR(64) NOT NULL UNIQUE
        REFERENCES catalog.data_product_versions (data_product_version_id),

    default_format                VARCHAR(32),
    supported_formats               JSONB NOT NULL DEFAULT '[]'::jsonb,

    expiration_hours                 INTEGER,

    filename_pattern                   VARCHAR(255),

    compression_policy                   JSONB NOT NULL DEFAULT '{}'::jsonb,

    default_delivery_mode                  VARCHAR(32),

    created_at                              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                               TIMESTAMPTZ NOT NULL DEFAULT now()
);
