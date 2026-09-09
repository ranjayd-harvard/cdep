-- AGENTS.md section 42. payload_snapshot is deliberately minimal debugging
-- metadata (execution key, scope, resolved version, delivery config) —
-- never a customer dataset or full request/response body.
CREATE TABLE scheduler_dead_letter (
    id VARCHAR(64) PRIMARY KEY,
    execution_id VARCHAR(64) NOT NULL,

    subscription_id VARCHAR(64) NOT NULL,
    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,

    failure_category VARCHAR(50),
    failure_code VARCHAR(100),
    failure_message TEXT,
    attempt_count INTEGER NOT NULL,

    payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

    dead_lettered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT
);
