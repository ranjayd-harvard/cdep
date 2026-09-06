-- The Exchanges table is the spine of the control plane: one row per
-- inbound upload or outbound download, regardless of direction.
CREATE TABLE exchange.exchanges (
    exchange_id VARCHAR(64) PRIMARY KEY,

    organization_id VARCHAR(64) NOT NULL REFERENCES exchange.organizations (organization_id),
    tenant_id       VARCHAR(64) NOT NULL REFERENCES exchange.tenants (tenant_id),

    direction       VARCHAR(16) NOT NULL,
    data_product_id VARCHAR(64) NOT NULL REFERENCES exchange.data_products (data_product_id),

    initiated_by_user_id VARCHAR(64),
    status                VARCHAR(32) NOT NULL,

    schema_version  VARCHAR(32),
    source_channel  VARCHAR(32),

    record_count BIGINT,
    error_count  BIGINT,

    started_at   TIMESTAMPTZ,
    received_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,

    correlation_id  VARCHAR(64),
    idempotency_key VARCHAR(128),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT exchanges_direction_chk CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT exchanges_status_chk CHECK (
        status IN (
            'PENDING_UPLOAD', 'UPLOADING', 'RECEIVED', 'VALIDATING', 'VALIDATION_FAILED',
            'VALIDATED', 'QUEUED_FOR_INGESTION', 'PROCESSING', 'COMPLETED', 'FAILED',
            'CANCELLED', 'EXPIRED',
            'PREPARING', 'READY', 'DOWNLOADED'
        )
    ),
    CONSTRAINT exchanges_tenant_fk FOREIGN KEY (tenant_id) REFERENCES exchange.tenants (tenant_id)
);

-- Idempotency keys must never leak across tenants: uniqueness is scoped to
-- (organization_id, tenant_id, idempotency_key), not global.
CREATE UNIQUE INDEX exchanges_idempotency_key_uq
    ON exchange.exchanges (organization_id, tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX exchanges_org_tenant_idx ON exchange.exchanges (organization_id, tenant_id);
CREATE INDEX exchanges_org_tenant_direction_idx ON exchange.exchanges (organization_id, tenant_id, direction);
CREATE INDEX exchanges_org_tenant_status_idx ON exchange.exchanges (organization_id, tenant_id, status);
CREATE INDEX exchanges_org_tenant_created_idx ON exchange.exchanges (organization_id, tenant_id, created_at DESC);
CREATE INDEX exchanges_data_product_idx ON exchange.exchanges (data_product_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (defense in depth, in addition to mandatory application
-- filtering — see src/database for how repository queries always include
-- organization_id/tenant_id predicates).
--
-- A future connection-scoped middleware can call, per transaction:
--   SELECT set_config('app.organization_id', $1, true);
--   SELECT set_config('app.tenant_id', $2, true);
-- before running tenant-owned queries, so that even a defect in application
-- filtering cannot leak cross-tenant rows. The policies below read those
-- session variables. When they are unset, the policy check simply matches
-- nothing (empty string), which fails closed rather than open.
-- ---------------------------------------------------------------------------
ALTER TABLE exchange.exchanges ENABLE ROW LEVEL SECURITY;

CREATE POLICY exchanges_tenant_isolation ON exchange.exchanges
    USING (
        organization_id = current_setting('app.organization_id', true)
        AND tenant_id = current_setting('app.tenant_id', true)
    );

-- The application's primary database role still bypasses RLS by default
-- (Postgres table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set).
-- FORCE is intentionally NOT enabled here: application code is the primary
-- enforcement point for Phase 2, and RLS is prepared but not yet load-bearing.
-- Enabling `ALTER TABLE exchange.exchanges FORCE ROW LEVEL SECURITY;` plus a
-- dedicated low-privilege application role is the documented future step.
