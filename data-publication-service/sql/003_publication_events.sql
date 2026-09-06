-- ---------------------------------------------------------------------------
-- publication_events: append-only event trail for one publication run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publication.publication_events (
    publication_event_id     BIGSERIAL PRIMARY KEY,
    publication_id           TEXT NOT NULL REFERENCES publication.publication_runs (publication_id),
    event_type                TEXT NOT NULL,
    event_data                 JSONB,
    occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
