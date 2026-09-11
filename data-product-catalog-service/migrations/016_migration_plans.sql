-- Phase 10 §9/§34-35: product-version migration plans and their per-
-- subscription tracking rows. NOTE: "migration" here means a Data Product
-- version migration (moving subscribers from one product version to
-- another), never a database schema migration — this repo's SQL migrations
-- live in this directory, a name collision that is intentional to avoid:
-- application code names these files/modules `migration-plan.*`, never bare
-- `migration.*`.
--
-- `migration_subscriptions.subscription_id`/`organization_id`/`tenant_id`
-- are a denormalized snapshot taken at plan-creation time via an HTTP call
-- to subscription-service (spec §35) — Catalog never queries
-- subscription-service's database directly, matching the cross-service
-- discipline already documented elsewhere in this codebase (no cross-DB FK).
CREATE TABLE catalog.migration_plans (
    migration_id       VARCHAR(64)  PRIMARY KEY,

    data_product_id      VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),

    from_version            VARCHAR(32)  NOT NULL,
    to_version                 VARCHAR(32)  NOT NULL,

    compatibility                VARCHAR(16)  NOT NULL
        CHECK (compatibility IN ('METADATA_ONLY', 'NON_BREAKING', 'BREAKING')),

    status                          VARCHAR(16)  NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED')),

    start_at                           TIMESTAMPTZ,
    deadline                             TIMESTAMPTZ,
    reason                                  TEXT,

    created_by                                   VARCHAR(255),
    created_at                                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE catalog.migration_subscriptions (
    migration_subscription_id  VARCHAR(64)  PRIMARY KEY,

    migration_id                  VARCHAR(64)  NOT NULL REFERENCES catalog.migration_plans (migration_id),

    subscription_id                  VARCHAR(64)  NOT NULL,
    organization_id                     VARCHAR(64)  NOT NULL,
    tenant_id                              VARCHAR(64)  NOT NULL,

    status                                    VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'MIGRATED', 'FAILED', 'SKIPPED')),

    migrated_at                                  TIMESTAMPTZ,
    failure_reason                                  TEXT,

    CONSTRAINT migration_subscriptions_unique UNIQUE (migration_id, subscription_id)
);

CREATE INDEX migration_plans_product_idx ON catalog.migration_plans (data_product_id, status);
CREATE INDEX migration_subscriptions_migration_idx ON catalog.migration_subscriptions (migration_id, status);
