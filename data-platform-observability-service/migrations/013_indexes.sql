-- Cross-cutting composite indexes for common operational time-window
-- queries (spec section 6) not already covered inline by an owning table's
-- own migration file — mirrors subscription-service's/scheduling-service's
-- precedent of a dedicated trailing indexes migration.
CREATE INDEX ix_operational_executions_tenant_product_time
    ON operational_executions (organization_id, tenant_id, data_product_id, product_version, started_at DESC);

CREATE INDEX ix_operational_executions_status
    ON operational_executions (overall_status, current_stage);

CREATE INDEX ix_operational_executions_publication
    ON operational_executions (publication_id) WHERE publication_id IS NOT NULL;

CREATE INDEX ix_operational_executions_inbound_exchange
    ON operational_executions (inbound_exchange_id) WHERE inbound_exchange_id IS NOT NULL;

CREATE INDEX ix_operational_executions_scheduled_run
    ON operational_executions (scheduled_run_id) WHERE scheduled_run_id IS NOT NULL;

CREATE INDEX ix_operational_executions_completed
    ON operational_executions (completed_at DESC) WHERE completed_at IS NOT NULL;

-- Open (not yet completed) executions per scope — the exact query the
-- correlation heuristic fallback runs (plan section 5).
CREATE INDEX ix_operational_executions_open_by_scope
    ON operational_executions (organization_id, tenant_id, data_product_id, product_version, started_at DESC)
    WHERE completed_at IS NULL;
