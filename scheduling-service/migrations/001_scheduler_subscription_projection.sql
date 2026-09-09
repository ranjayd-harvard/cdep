-- Operational scheduling projection only (AGENTS.md section 10/section 9).
-- Subscription Service remains the source of truth for subscription
-- configuration; this table stores only what's needed to evaluate due
-- times efficiently, refreshed by the reconciler whenever the upstream
-- subscription's revision (`version`) changes.
CREATE TABLE scheduler_subscription_projection (
    id VARCHAR(64) PRIMARY KEY,

    subscription_id VARCHAR(64) NOT NULL UNIQUE,
    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    data_product_id VARCHAR(255) NOT NULL,

    subscription_status VARCHAR(30) NOT NULL,
    schedule_mode VARCHAR(20) NOT NULL CHECK (schedule_mode IN ('ON_DEMAND', 'DAILY', 'WEEKLY', 'CRON')),

    timezone VARCHAR(64),
    delivery_time_local VARCHAR(8),
    day_of_week VARCHAR(10) CHECK (day_of_week IS NULL OR day_of_week IN ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')),
    cron_expression VARCHAR(120),

    next_run_at TIMESTAMPTZ,

    last_reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    subscription_revision BIGINT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
