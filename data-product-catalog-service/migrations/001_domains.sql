CREATE SCHEMA IF NOT EXISTS catalog;

-- A Domain groups Data Products by business area (e.g. "events", "finance").
-- Domains are provisioned ahead of registration; a contract referencing an
-- unknown domain_id is rejected (see AGENTS.md §5/§37 in the Catalog spec —
-- "validate domain").
CREATE TABLE catalog.domains (
    domain_id     VARCHAR(64)  PRIMARY KEY,
    name          VARCHAR(128) NOT NULL UNIQUE,
    display_name  VARCHAR(255) NOT NULL,
    description   TEXT,
    status        VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT domains_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
