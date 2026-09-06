-- ---------------------------------------------------------------------------
-- publication_quality_results: one row per (publication_run, rule)
-- evaluation (AGENTS.md section 52).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publication.publication_quality_results (
    quality_result_id      BIGSERIAL PRIMARY KEY,
    publication_id          TEXT NOT NULL REFERENCES publication.publication_runs (publication_id),

    rule_name                 TEXT NOT NULL,
    severity                    TEXT NOT NULL,

    total_count                 BIGINT,
    failed_count                 BIGINT,

    passed                        BOOLEAN NOT NULL,

    evaluated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_publication_quality_results_run
    ON publication.publication_quality_results (publication_id);
