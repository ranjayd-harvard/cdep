-- The central execution record (AGENTS.md section 10/12/59). The UNIQUE
-- constraint on execution_key is the primary duplicate-prevention
-- mechanism (section 12/34): scheduler restarts, overlapping leadership,
-- and duplicate due-scans all converge on inserting the same row and
-- losing the UNIQUE-violation race, never creating a second logical
-- execution.
CREATE TABLE scheduled_execution (
    id VARCHAR(64) PRIMARY KEY,
    execution_key VARCHAR(400) NOT NULL UNIQUE,

    subscription_id VARCHAR(64) NOT NULL,
    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    data_product_id VARCHAR(255) NOT NULL,

    reason VARCHAR(30) NOT NULL CHECK (reason IN ('SCHEDULED', 'MANUAL', 'ON_DEMAND', 'MISSED_RUN_RECOVERY', 'RETRY')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    triggered_at TIMESTAMPTZ,

    requested_version_policy_type VARCHAR(30),
    requested_version_policy_value VARCHAR(100),
    resolved_product_version VARCHAR(100),

    delivery_method VARCHAR(20),
    format VARCHAR(20),

    status VARCHAR(30) NOT NULL CHECK (status IN (
        'PENDING', 'EVALUATING', 'ELIGIBLE', 'DISPATCHING', 'SUBMITTED',
        'RETRY_WAIT', 'SKIPPED', 'SUCCEEDED', 'TERMINAL_FAILED', 'DEAD_LETTERED', 'CANCELLED'
    )),

    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ,

    -- Stores the full execution_key (the value sent to Publication Service
    -- as external_idempotency_key), not a short generated id — must be at
    -- least as wide as execution_key itself.
    publication_request_id VARCHAR(400),
    publication_id VARCHAR(64),

    failure_category VARCHAR(50),
    failure_code VARCHAR(100),
    failure_message TEXT,
    ineligibility_reason_code VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
