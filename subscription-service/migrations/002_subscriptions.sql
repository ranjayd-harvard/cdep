CREATE TABLE subscriptions (
    subscription_id VARCHAR(64) PRIMARY KEY,

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,

    data_product_id VARCHAR(255) NOT NULL,

    status VARCHAR(30) NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'CANCELLED')),

    version_policy_type VARCHAR(30) NOT NULL CHECK (version_policy_type IN ('EXACT', 'COMPATIBLE_MAJOR', 'LATEST_ACTIVE')),
    version_policy_value VARCHAR(100),

    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    activated_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,

    suspension_reason TEXT,
    cancellation_reason TEXT,

    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    version BIGINT NOT NULL DEFAULT 1
);

-- Only one live logical subscription per tenant/product (spec §15). A
-- cancelled subscription does not block a new one from being created —
-- enforced with a partial index rather than a plain unique constraint.
CREATE UNIQUE INDEX ux_subscriptions_tenant_product_live
ON subscriptions (organization_id, tenant_id, data_product_id)
WHERE status <> 'CANCELLED';
