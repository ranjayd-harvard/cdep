-- Phase 11 §25/§28/§29: legal hold + deletion workflow + append-only
-- security/governance audit — data-exchange-service owns the physical
-- outbound artifact (exchange_files.bucket_name/object_key), so it's the
-- natural owner of retention/deletion for exchanges, mirroring the pattern
-- already established in scheduling-service/subscription-service for
-- their own audit tables.

ALTER TABLE exchange.exchanges
  ADD COLUMN legal_hold BOOLEAN NOT NULL DEFAULT false;

-- One row per deletion attempt (spec §24) — REQUESTED/APPROVED/IN_PROGRESS
-- are collapsed into one synchronous transition in this implementation
-- (no separate approval workflow exists yet), but the full status
-- vocabulary is modeled so a future approval step is additive, not a
-- reshape.
CREATE TABLE exchange.deletion_requests (
    deletion_request_id VARCHAR(64) PRIMARY KEY,
    exchange_id          VARCHAR(64) NOT NULL REFERENCES exchange.exchanges (exchange_id),

    status VARCHAR(16) NOT NULL,
    reason VARCHAR(255),

    requested_by VARCHAR(64),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,

    CONSTRAINT deletion_requests_status_chk CHECK (
        status IN ('REQUESTED', 'APPROVED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED')
    )
);

CREATE INDEX deletion_requests_exchange_id_idx ON exchange.deletion_requests (exchange_id);

-- Append-only security/governance audit (spec §28/§29). No UPDATE/DELETE
-- grant is given to the application role (app_exchange, migrations/
-- 010_least_privilege_role.sql) — see the GRANT below.
CREATE TABLE exchange.security_audit_events (
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

CREATE INDEX security_audit_events_org_tenant_idx ON exchange.security_audit_events (organization_id, tenant_id);
CREATE INDEX security_audit_events_resource_idx ON exchange.security_audit_events (resource_type, resource_id);

GRANT SELECT, INSERT, UPDATE ON exchange.deletion_requests TO app_exchange;
-- Append-only: INSERT + SELECT only, deliberately no UPDATE/DELETE grant.
GRANT SELECT, INSERT ON exchange.security_audit_events TO app_exchange;
