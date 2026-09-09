-- AGENTS.md section 11.
CREATE INDEX ix_scheduler_projection_next_run_at ON scheduler_subscription_projection (next_run_at);
CREATE INDEX ix_scheduler_projection_org_tenant ON scheduler_subscription_projection (organization_id, tenant_id);

CREATE INDEX ix_scheduled_execution_subscription_scheduled_for ON scheduled_execution (subscription_id, scheduled_for);
CREATE INDEX ix_scheduled_execution_status_next_retry ON scheduled_execution (status, next_retry_at);
CREATE INDEX ix_scheduled_execution_org_tenant ON scheduled_execution (organization_id, tenant_id, created_at DESC);
CREATE INDEX ix_scheduled_execution_pending ON scheduled_execution (status, created_at) WHERE status = 'PENDING';

CREATE INDEX ix_scheduler_dead_letter_execution ON scheduler_dead_letter (execution_id);
CREATE INDEX ix_scheduler_dead_letter_unresolved ON scheduler_dead_letter (dead_lettered_at) WHERE resolved_at IS NULL;

CREATE INDEX ix_scheduler_audit_events_subscription ON scheduler_audit_events (subscription_id, occurred_at DESC);
CREATE INDEX ix_scheduler_audit_events_execution ON scheduler_audit_events (execution_id, occurred_at DESC);
CREATE INDEX ix_scheduler_audit_events_org_tenant ON scheduler_audit_events (organization_id, tenant_id, occurred_at DESC);
