-- Data products describe the logical business datasets that flow through
-- the exchange. The Exchange Service does not interpret their contents.
CREATE TABLE exchange.data_products (
    data_product_id         VARCHAR(64) PRIMARY KEY,
    name                     VARCHAR(255) NOT NULL,
    description              TEXT,
    direction                VARCHAR(16)  NOT NULL,
    current_schema_version   VARCHAR(32)  NOT NULL,
    status                   VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT data_products_direction_chk CHECK (direction IN ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL')),
    CONSTRAINT data_products_status_chk CHECK (status IN ('ACTIVE', 'DEPRECATED', 'DISABLED'))
);

-- Tenant entitlements: which tenants may upload/download which data products.
-- The service MUST check this table before issuing any signed URL.
CREATE TABLE exchange.tenant_data_product_entitlements (
    tenant_id       VARCHAR(64) NOT NULL REFERENCES exchange.tenants (tenant_id),
    data_product_id VARCHAR(64) NOT NULL REFERENCES exchange.data_products (data_product_id),
    can_upload      BOOLEAN     NOT NULL DEFAULT false,
    can_download    BOOLEAN     NOT NULL DEFAULT false,
    status          VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, data_product_id),
    CONSTRAINT tenant_dp_entitlements_status_chk CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);
