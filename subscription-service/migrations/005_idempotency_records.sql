CREATE TABLE idempotency_records (
    idempotency_key VARCHAR(255) NOT NULL,

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,

    operation VARCHAR(100) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,

    response_status INTEGER NOT NULL,
    response_body JSONB NOT NULL,

    resource_id VARCHAR(64),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (idempotency_key, organization_id, tenant_id, operation)
);

CREATE INDEX ix_idempotency_records_expiry ON idempotency_records (expires_at);
