-- Phase 11 (spec §28/§29) — append-only security/governance audit,
-- distinct from registration_events (contract-lifecycle provenance):
-- this table answers "who was denied access, and what policy violation
-- was rejected", not "what changed about a contract".
CREATE TABLE catalog.security_audit_events (
    event_id VARCHAR(64) PRIMARY KEY,

    event_type VARCHAR(60) NOT NULL,
    actor_type VARCHAR(20) NOT NULL,
    actor_id VARCHAR(255),

    organization_id VARCHAR(64),
    tenant_id VARCHAR(64),
    resource_type VARCHAR(60),
    resource_id VARCHAR(64),

    decision VARCHAR(16),
    reason_code VARCHAR(60),
    correlation_id VARCHAR(64),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX security_audit_events_resource_idx ON catalog.security_audit_events (resource_type, resource_id);
