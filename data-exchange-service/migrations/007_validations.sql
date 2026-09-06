-- Summary-level validation results. Row-level error detail is NOT stored
-- here at scale — large error reports are written to object storage as an
-- ERROR_REPORT exchange_files row and only a bounded sample/summary lives
-- in error_summary (JSONB) here.
CREATE TABLE exchange.exchange_validations (
    validation_id VARCHAR(64) PRIMARY KEY,
    exchange_id   VARCHAR(64) NOT NULL REFERENCES exchange.exchanges (exchange_id),

    validation_type VARCHAR(64),
    status           VARCHAR(32) NOT NULL,

    total_records   BIGINT,
    valid_records   BIGINT,
    invalid_records BIGINT,

    error_summary JSONB,

    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    CONSTRAINT exchange_validations_status_chk CHECK (
        status IN ('PENDING', 'RUNNING', 'PASSED', 'FAILED')
    )
);

CREATE INDEX exchange_validations_exchange_id_idx ON exchange.exchange_validations (exchange_id);
