-- Delivery methods supported by a version. FILE carries PARQUET/CSV format
-- options inside `configuration`; API is a placeholder for future use
-- (delivery EXECUTION is out of scope — spec §23). Future methods (SFTP,
-- DATA_SHARE, EVENT, STREAM) reuse this same table shape.
CREATE TABLE catalog.supported_delivery_methods (
    delivery_method_id          VARCHAR(64) PRIMARY KEY,

    data_product_version_id      VARCHAR(64) NOT NULL
        REFERENCES catalog.data_product_versions (data_product_version_id),

    method                         VARCHAR(32) NOT NULL,
    enabled                          BOOLEAN NOT NULL DEFAULT true,

    configuration                     JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT delivery_methods_unique UNIQUE (data_product_version_id, method),
    CONSTRAINT delivery_methods_method_chk CHECK (
        method IN ('FILE', 'API', 'SFTP', 'DATA_SHARE', 'EVENT', 'STREAM')
    )
);
