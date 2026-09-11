-- Phase 11 §24: allow the terminal DELETED status for outbound exchanges
-- once the deletion workflow has physically removed the artifact.
ALTER TABLE exchange.exchanges DROP CONSTRAINT exchanges_status_chk;
ALTER TABLE exchange.exchanges ADD CONSTRAINT exchanges_status_chk CHECK (
    status IN (
        'PENDING_UPLOAD', 'UPLOADING', 'RECEIVED', 'VALIDATING', 'VALIDATION_FAILED',
        'VALIDATED', 'QUEUED_FOR_INGESTION', 'PROCESSING', 'COMPLETED', 'FAILED',
        'CANCELLED', 'EXPIRED',
        'PREPARING', 'READY', 'DOWNLOADED', 'DELETED'
    )
);
