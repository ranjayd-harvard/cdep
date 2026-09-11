-- Phase 11 (spec §13): a distinct, least-privilege application role,
-- separate from the migration/owner role this service's connection has
-- used until now. The owner role (POSTGRES_USER in docker-compose, "exchange")
-- keeps running migrations and is a table owner, which means it bypasses
-- Row Level Security by default; app_exchange does NOT own any table, so
-- the RLS policy on exchange.exchanges/exchange.pipeline_jobs (see
-- migrations/004_exchanges.sql, 009_pipeline_jobs.sql) applies to it
-- automatically the moment the application connects as this role — no
-- FORCE ROW LEVEL SECURITY needed for a non-owner role.
--
-- The password below is a local-dev default, analogous to every other
-- placeholder credential in this repo's docker-compose files (documented
-- in docs/security/tenant-isolation.md) — production deployment must
-- override it via the SecretProvider (spec §27), not this migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_exchange') THEN
    CREATE ROLE app_exchange LOGIN PASSWORD 'app_exchange_change_me';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA exchange TO app_exchange;

-- Reference/catalog tables the app reads but never mutates directly through
-- customer-facing tenant-scoped code paths.
GRANT SELECT ON
  exchange.organizations,
  exchange.tenants,
  exchange.tenant_memberships,
  exchange.data_products,
  exchange.tenant_data_product_entitlements
TO app_exchange;

-- Tenant-owned tables with RLS policies — SELECT/INSERT/UPDATE only, no
-- DELETE (this service never hard-deletes an exchange row) and no DDL.
GRANT SELECT, INSERT, UPDATE ON exchange.exchanges, exchange.pipeline_jobs TO app_exchange;

-- Child tables reached only via exchange_id FK (no tenant column of their
-- own, no RLS policy — ownership is enforced by the parent lookup already
-- being tenant-scoped before these are ever queried).
GRANT SELECT, INSERT ON exchange.exchange_files, exchange.exchange_events, exchange.exchange_validations TO app_exchange;
