-- Phase 7 (scheduling-service AGENTS.md section 8/20): adds CRON as a
-- valid frequency. day_of_week/cron_expression themselves need no new
-- columns — they ride inside the pre-existing, previously-unused
-- `configuration` JSONB column (see delivery-preference.repository.ts).
ALTER TABLE subscription_delivery_preferences DROP CONSTRAINT subscription_delivery_preferences_frequency_check;
ALTER TABLE subscription_delivery_preferences ADD CONSTRAINT subscription_delivery_preferences_frequency_check
    CHECK (frequency IN ('ON_DEMAND', 'DAILY', 'WEEKLY', 'MONTHLY', 'CRON'));
