-- Phase 7 (scheduling-service) cross-service idempotency: the Scheduler's
-- own deterministic execution key, distinct from this service's internal
-- gold_ready-derived idempotency_key (which changes if the underlying Gold
-- snapshot changes between retries). Not UNIQUE: a prior FAILED attempt
-- under the same key must not block a later retry attempt from inserting
-- its own row. PublicationRepository.find_by_external_idempotency_key only
-- matches status='READY' rows, the same convention idempotency_key already
-- uses.
ALTER TABLE publication.publication_runs
    ADD COLUMN IF NOT EXISTS external_idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS ix_publication_runs_external_idempotency
    ON publication.publication_runs (external_idempotency_key);
