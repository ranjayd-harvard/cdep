-- Append-only lifecycle audit trail. Application code must only ever INSERT
-- into this table (see src/events/exchange-event.service.ts) — never UPDATE
-- or DELETE. This is the authoritative record of what happened, when, and
-- by whom, and drives the Customer Portal's exchange timeline view.
CREATE TABLE exchange.exchange_events (
    event_id    VARCHAR(64) PRIMARY KEY,
    exchange_id VARCHAR(64) NOT NULL REFERENCES exchange.exchanges (exchange_id),

    event_type  VARCHAR(64) NOT NULL,
    from_status VARCHAR(32),
    to_status   VARCHAR(32),

    actor_type VARCHAR(32),
    actor_id   VARCHAR(64),

    event_data JSONB,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT exchange_events_actor_type_chk CHECK (
        actor_type IS NULL OR actor_type IN ('USER', 'SERVICE_ACCOUNT', 'SYSTEM', 'PLATFORM_ADMIN')
    )
);

CREATE INDEX exchange_events_exchange_id_idx ON exchange.exchange_events (exchange_id, occurred_at);
