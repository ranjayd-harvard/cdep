-- Append-only (AGENTS.md section 40/59) — every attempted scheduled
-- execution must be reconstructable: why it existed, what was checked, and
-- what happened.
CREATE TABLE scheduler_audit_events (
    id VARCHAR(64) PRIMARY KEY,

    event_type VARCHAR(60) NOT NULL,
    actor_type VARCHAR(20) NOT NULL,
    actor_id VARCHAR(255),

    organization_id VARCHAR(64),
    tenant_id VARCHAR(64),
    subscription_id VARCHAR(64),
    execution_id VARCHAR(64),
    correlation_id VARCHAR(64),

    metadata JSONB,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
