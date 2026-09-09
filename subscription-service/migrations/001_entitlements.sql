CREATE TABLE entitlements (
    entitlement_id VARCHAR(64) PRIMARY KEY,

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,

    data_product_id VARCHAR(255) NOT NULL,

    effect VARCHAR(20) NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),

    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,

    reason TEXT,

    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    revoked_at TIMESTAMPTZ,
    revoked_by VARCHAR(255),

    version BIGINT NOT NULL DEFAULT 1
);

-- One current entitlement decision per tenant/product (spec §11). History
-- is preserved via subscription_audit_events, not by keeping old rows.
CREATE UNIQUE INDEX ux_entitlements_tenant_product
ON entitlements (organization_id, tenant_id, data_product_id);
