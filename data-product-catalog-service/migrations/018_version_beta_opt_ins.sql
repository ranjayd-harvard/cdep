-- Phase 10 §11: tenant beta eligibility. A BETA version is unreachable by
-- normal subscriptions; a (organization_id, tenant_id) pair opted in here
-- may resolve to it via EXACT pin or explicit-version API access
-- (spec §18, §28-29, §38).
CREATE TABLE catalog.version_beta_opt_ins (
    beta_opt_in_id            VARCHAR(64)  PRIMARY KEY,

    data_product_version_id     VARCHAR(64)  NOT NULL REFERENCES catalog.data_product_versions (data_product_version_id),

    organization_id                VARCHAR(64)  NOT NULL,
    tenant_id                         VARCHAR(64)  NOT NULL,

    opted_in_by                          VARCHAR(255) NOT NULL,
    opted_in_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT version_beta_opt_ins_unique UNIQUE (data_product_version_id, organization_id, tenant_id)
);

CREATE INDEX version_beta_opt_ins_tenant_idx
    ON catalog.version_beta_opt_ins (organization_id, tenant_id);
