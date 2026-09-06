-- Organizations
CREATE TABLE exchange.organizations (
    organization_id VARCHAR(64) PRIMARY KEY,
    display_name    VARCHAR(255) NOT NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT organizations_status_chk CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'))
);

-- Tenants
CREATE TABLE exchange.tenants (
    tenant_id       VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES exchange.organizations (organization_id),
    display_name    VARCHAR(255) NOT NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT tenants_status_chk CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'))
);

CREATE INDEX tenants_organization_id_idx ON exchange.tenants (organization_id);

-- Tenant memberships: application-level authorization relationships only.
-- The authoritative identity provider lives outside this service; this table
-- does NOT store credentials, only "who may act as whom, in which tenant,
-- with which role".
CREATE TABLE exchange.tenant_memberships (
    user_id         VARCHAR(64) NOT NULL,
    organization_id VARCHAR(64) NOT NULL,
    tenant_id       VARCHAR(64) NOT NULL,
    role            VARCHAR(32) NOT NULL,
    status          VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, organization_id, tenant_id),
    FOREIGN KEY (organization_id) REFERENCES exchange.organizations (organization_id),
    FOREIGN KEY (tenant_id) REFERENCES exchange.tenants (tenant_id),
    CONSTRAINT tenant_memberships_role_chk CHECK (
        role IN ('CUSTOMER_ADMIN', 'CUSTOMER_USER', 'CUSTOMER_READONLY', 'SERVICE_ACCOUNT', 'PLATFORM_ADMIN')
    ),
    CONSTRAINT tenant_memberships_status_chk CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);

CREATE INDEX tenant_memberships_tenant_id_idx ON exchange.tenant_memberships (tenant_id);
