CREATE TABLE subscription_audit_events (
    audit_event_id VARCHAR(64) PRIMARY KEY,

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,

    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,

    action VARCHAR(100) NOT NULL,

    previous_state JSONB,
    new_state JSONB,

    actor_type VARCHAR(30) NOT NULL,
    actor_id VARCHAR(255),

    correlation_id VARCHAR(64),
    idempotency_key VARCHAR(255),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
