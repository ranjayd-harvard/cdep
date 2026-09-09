CREATE SCHEMA IF NOT EXISTS api_serving;

-- ---------------------------------------------------------------------------
-- api_serving.event_performance_events: the API Serving Store for the
-- "event-performance" Data Product's "events" resource (spec §8.2/§8.3).
--
-- This is NOT a mirror of Gold's physical columns -- only the fields the
-- Catalog contract publishes (venue_id, event_date, tickets_sold,
-- gross_revenue, revenue_per_ticket) are ever returned by
-- data-product-api-service -- every other column here is INTERNAL and must
-- never be serialized into a customer response (spec §8.9/§8.18).
--
-- Tenant isolation is structural, not a query-time convention: event_id is
-- deliberately NOT globally unique (spec §8.3 "do not treat event_id as
-- globally unique") -- the grain key is (organization_id, tenant_id,
-- event_id), so the same event_id can carry entirely different data across
-- tenants (see the Tenant A/B demo).
--
-- `staging` is a byte-for-byte structural twin used by the full-refresh
-- atomic swap (see serving_store/repository.py `swap_staging_into_live`):
-- a failed refresh only ever touches `staging`, never `live`, so the
-- previous successful snapshot stays servable throughout a run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_serving.event_performance_events (
    organization_id             TEXT NOT NULL,
    tenant_id                   TEXT NOT NULL,
    product_version             TEXT NOT NULL,

    event_id                    TEXT NOT NULL,
    venue_id                    TEXT NOT NULL,
    event_date                  DATE NOT NULL,
    tickets_sold                BIGINT,
    gross_revenue               NUMERIC(18, 2),
    revenue_per_ticket          NUMERIC(18, 2),

    source_updated_at           TIMESTAMPTZ NOT NULL,
    serving_snapshot_id         TEXT NOT NULL,
    serving_loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_change_token         TEXT NOT NULL,

    -- Internal Gold lineage, carried through unchanged (spec §8.18 requires
    -- these to exist in serving test data so the contract-safety regression
    -- test has real internal fields to prove never leak).
    _gold_pipeline_run_id       TEXT,
    _silver_pipeline_run_id     TEXT,

    -- Reserved for future exchange/ingestion lineage wiring -- Gold's
    -- event-performance schema does not carry these today (see
    -- data-lakehouse/src/lakehouse/gold/products/event_performance.py), so
    -- they are populated with a deterministic placeholder by the seed/demo
    -- fixtures purely so the internal-field-stripping regression test has
    -- something concrete to assert against.
    ingestion_id                TEXT,
    exchange_id                 TEXT,
    storage_path                TEXT,

    PRIMARY KEY (organization_id, tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS api_serving.event_performance_events_staging (
    LIKE api_serving.event_performance_events INCLUDING ALL
);
