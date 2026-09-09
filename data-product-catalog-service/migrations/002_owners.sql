-- An Owner is the accountable team/person/system for a Data Product.
-- Production Data Products should prefer TEAM ownership (spec §8); PERSON
-- and SYSTEM remain valid for draft/experimental products.
CREATE TABLE catalog.owners (
    owner_id    VARCHAR(64)  PRIMARY KEY,
    owner_type  VARCHAR(16)  NOT NULL,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255),
    team        VARCHAR(255),
    status      VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT owners_type_chk CHECK (owner_type IN ('TEAM', 'PERSON', 'SYSTEM')),
    CONSTRAINT owners_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
