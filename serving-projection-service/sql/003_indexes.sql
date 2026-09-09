-- Index set matches exactly the query patterns data-product-api-service's
-- Contract-driven query engine supports for event-performance (spec §8.3):
-- event_id/venue_id equality filters, event_date range filters,
-- updated_since, and the mandatory (event_date, event_id) / (event_id)
-- deterministic sort orders used for cursor pagination. No index exists for
-- any column the API contract does not expose as a filter or sort, on
-- purpose (spec §8.3 "based only on supported API query patterns").
CREATE INDEX IF NOT EXISTS idx_epe_org_tenant_date_id
    ON api_serving.event_performance_events (organization_id, tenant_id, event_date, event_id);

CREATE INDEX IF NOT EXISTS idx_epe_org_tenant_venue_date_id
    ON api_serving.event_performance_events (organization_id, tenant_id, venue_id, event_date, event_id);

CREATE INDEX IF NOT EXISTS idx_epe_org_tenant_updated_id
    ON api_serving.event_performance_events (organization_id, tenant_id, source_updated_at, event_id);

CREATE INDEX IF NOT EXISTS idx_projection_runs_product_started
    ON api_serving.projection_runs (product_id, product_version, started_at DESC);

-- The staging table is a `LIKE ... INCLUDING ALL` twin created before these
-- indexes existed (001 runs before 003), so it needs its own copies --
-- otherwise the full-refresh atomic rename swap (live <-> staging) would
-- silently swap an indexed table out for an unindexed one every run.
CREATE INDEX IF NOT EXISTS idx_epe_staging_org_tenant_date_id
    ON api_serving.event_performance_events_staging (organization_id, tenant_id, event_date, event_id);

CREATE INDEX IF NOT EXISTS idx_epe_staging_org_tenant_venue_date_id
    ON api_serving.event_performance_events_staging (organization_id, tenant_id, venue_id, event_date, event_id);

CREATE INDEX IF NOT EXISTS idx_epe_staging_org_tenant_updated_id
    ON api_serving.event_performance_events_staging (organization_id, tenant_id, source_updated_at, event_id);
