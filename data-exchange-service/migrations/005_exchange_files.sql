-- One row per physical object associated with an exchange: the data file
-- itself, plus sidecar metadata objects (manifest, validation report, etc).
-- bucket_name/object_key are internal storage coordinates and must never be
-- returned directly to customer-facing API responses.
CREATE TABLE exchange.exchange_files (
    exchange_file_id VARCHAR(64) PRIMARY KEY,
    exchange_id      VARCHAR(64) NOT NULL REFERENCES exchange.exchanges (exchange_id),

    file_role VARCHAR(32) NOT NULL,

    original_filename VARCHAR(512),
    stored_filename    VARCHAR(512),

    bucket_name VARCHAR(255) NOT NULL,
    object_key  VARCHAR(1024) NOT NULL,

    content_type VARCHAR(255),
    file_format  VARCHAR(32),

    size_bytes BIGINT,

    checksum_algorithm VARCHAR(32),
    checksum            VARCHAR(128),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT exchange_files_role_chk CHECK (
        file_role IN ('DATA', 'MANIFEST', 'VALIDATION', 'PROCESSING', 'ERROR_REPORT')
    )
);

CREATE INDEX exchange_files_exchange_id_idx ON exchange.exchange_files (exchange_id);
CREATE UNIQUE INDEX exchange_files_bucket_key_uq ON exchange.exchange_files (bucket_name, object_key);
