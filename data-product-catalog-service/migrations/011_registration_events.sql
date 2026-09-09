-- Append-only audit log answering the questions in spec §36 (which
-- contract/commit/hash/actor registered or transitioned a version, and
-- when). Never updated or deleted after insert.
CREATE TABLE catalog.registration_events (
    event_id           VARCHAR(64) PRIMARY KEY,

    data_product_id      VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    version                VARCHAR(32),

    event_type               VARCHAR(64) NOT NULL,

    actor_type                 VARCHAR(16) NOT NULL,
    actor_id                     VARCHAR(255),

    event_data                     JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT registration_events_actor_type_chk CHECK (actor_type IN ('CI', 'SERVICE', 'USER', 'SYSTEM'))
);
