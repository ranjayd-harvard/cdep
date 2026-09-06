CREATE INDEX IF NOT EXISTS ix_publication_runs_idempotency
    ON publication.publication_runs (idempotency_key);

CREATE INDEX IF NOT EXISTS ix_publication_runs_tenant
    ON publication.publication_runs (organization_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_publication_runs_source_pipeline_run
    ON publication.publication_runs (source_pipeline_run_id);

CREATE INDEX IF NOT EXISTS ix_publication_runs_status
    ON publication.publication_runs (status);

CREATE INDEX IF NOT EXISTS ix_publication_artifacts_publication
    ON publication.publication_artifacts (publication_id);

CREATE INDEX IF NOT EXISTS ix_publication_events_run
    ON publication.publication_events (publication_id, occurred_at);
