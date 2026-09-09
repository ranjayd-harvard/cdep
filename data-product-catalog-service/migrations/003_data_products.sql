-- A Data Product is the top-level, version-independent catalog entry (e.g.
-- "event-performance"). Its `current_active_version` is a denormalized
-- pointer maintained by the activation flow (registration.service.ts) — the
-- authoritative per-version lifecycle state still lives on
-- catalog.data_product_versions.lifecycle_status.
CREATE TABLE catalog.data_products (
    data_product_id          VARCHAR(128) PRIMARY KEY,

    name                      VARCHAR(255) NOT NULL,
    display_name              VARCHAR(255) NOT NULL,

    domain_id                 VARCHAR(64)  NOT NULL REFERENCES catalog.domains (domain_id),
    owner_id                  VARCHAR(64)  NOT NULL REFERENCES catalog.owners (owner_id),

    description                TEXT,

    product_type               VARCHAR(32)  NOT NULL DEFAULT 'DATASET',

    status                     VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',

    current_active_version     VARCHAR(32),

    subscribable                BOOLEAN     NOT NULL DEFAULT false,
    discoverable                 BOOLEAN     NOT NULL DEFAULT true,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT data_products_type_chk CHECK (product_type IN ('DATASET', 'API', 'FILE', 'MULTI_CHANNEL')),
    CONSTRAINT data_products_status_chk CHECK (status IN ('ACTIVE', 'DEPRECATED', 'RETIRED', 'DRAFT'))
);
