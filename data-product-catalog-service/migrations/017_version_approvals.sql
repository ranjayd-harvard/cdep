-- Phase 10 §10/§24: a lightweight approval log, not a workflow engine
-- (explicitly out of scope — no approval chains, no multi-step states).
-- One row per approval action. A version whose latest compatibility
-- evaluation is BREAKING must have a matching row here before it can leave
-- DRAFT for BETA/ACTIVE (enforced in application code, lifecycle.service.ts).
CREATE TABLE catalog.version_approvals (
    approval_id          VARCHAR(64)  PRIMARY KEY,

    data_product_id        VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    version                   VARCHAR(32)  NOT NULL,

    compatibility_level        VARCHAR(16)  NOT NULL
        CHECK (compatibility_level IN ('METADATA_ONLY', 'NON_BREAKING', 'BREAKING')),

    required                     BOOLEAN     NOT NULL,

    approved_by                    VARCHAR(255) NOT NULL,
    approved_reason                   TEXT,
    approved_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX version_approvals_version_idx
    ON catalog.version_approvals (data_product_id, version, approved_at DESC);
