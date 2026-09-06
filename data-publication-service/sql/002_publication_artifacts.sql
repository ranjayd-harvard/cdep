-- ---------------------------------------------------------------------------
-- publication_artifacts: one row per exported file belonging to a
-- publication run. A single publication may produce more than one artifact
-- file (see AGENTS.md section 47) even though Phase 4's first Data Product
-- only ever produces one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publication.publication_artifacts (
    artifact_id            TEXT PRIMARY KEY,

    publication_id         TEXT NOT NULL REFERENCES publication.publication_runs (publication_id),

    filename                TEXT NOT NULL,
    format                  TEXT NOT NULL,

    content_type            TEXT,
    compression              TEXT,

    size_bytes               BIGINT,

    checksum_algorithm       TEXT,
    checksum                 TEXT,

    record_count             BIGINT,

    outbound_exchange_id     TEXT,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
