-- Phase 11 (spec §13) — same rationale as data-exchange-service's
-- migrations/010_least_privilege_role.sql: a distinct, non-owner
-- application role so Row Level Security (once policies + session-variable
-- wiring are added, tracked in docs/security/tenant-isolation.md) applies
-- to the application's own connection, not just to hypothetical other
-- roles. Local-dev placeholder password only — production overrides via
-- SecretProvider (spec §27).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_subscription') THEN
    CREATE ROLE app_subscription LOGIN PASSWORD 'app_subscription_change_me';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_subscription;
GRANT SELECT, INSERT, UPDATE ON entitlements, subscriptions, subscription_delivery_preferences TO app_subscription;
GRANT SELECT, INSERT ON subscription_audit_events, idempotency_records TO app_subscription;
