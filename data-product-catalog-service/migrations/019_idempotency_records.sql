-- Phase 10 §43: idempotency-key support, needed for
-- POST /internal/v1/data-products/:productId/migrations. Catalog had no
-- idempotency infrastructure before Phase 10 (unlike subscription-service,
-- which already has this table under a different name) — ported here with
-- the same shape as subscription-service/migrations/005_idempotency_records.sql
-- so both services' with-idempotency wrapper code can stay structurally
-- identical.
CREATE TABLE catalog.idempotency_records (
    idempotency_key      VARCHAR(255) NOT NULL,

    scope                   VARCHAR(128) NOT NULL,  -- e.g. the data_product_id a migration plan is scoped to
    operation                  VARCHAR(100) NOT NULL,
    request_hash                  VARCHAR(64)  NOT NULL,

    response_status                  INTEGER      NOT NULL,
    response_body                       JSONB        NOT NULL,

    resource_id                            VARCHAR(64),

    created_at                                TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at                                   TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (idempotency_key, scope, operation)
);

CREATE INDEX idempotency_records_expiry_idx ON catalog.idempotency_records (expires_at);
