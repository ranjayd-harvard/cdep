-- Phase 10 §28/§32: five version policy types instead of three.
-- COMPATIBLE_MAJOR is renamed to COMPATIBLE_MINOR (identical "1.x floats
-- across minor and patch" semantics — spec's own text confirms this is a
-- rename, not a new option), and COMPATIBLE_PATCH/PINNED_MAJOR are added.
-- Existing rows are data-migrated in the same transaction as the
-- constraint widen, not left on the old name.
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_version_policy_type_check;

UPDATE subscriptions SET version_policy_type = 'COMPATIBLE_MINOR' WHERE version_policy_type = 'COMPATIBLE_MAJOR';

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_version_policy_type_check
    CHECK (version_policy_type IN ('EXACT', 'COMPATIBLE_PATCH', 'COMPATIBLE_MINOR', 'PINNED_MAJOR', 'LATEST_ACTIVE'));

-- minor_upgrade_behavior only meaningfully distinguishes PINNED_MAJOR from
-- COMPATIBLE_MINOR (spec §28); AUTO_UPGRADE_MINOR is the default for every
-- policy type, and a no-op for types where it doesn't apply.
-- last_resolved_version is updated after every successful "DELIVER"
-- resolution (spec §32) — it's the PIN_CURRENT/MANUAL_APPROVAL hint and
-- also directly answers "what version is this subscription actually on."
ALTER TABLE subscriptions
  ADD COLUMN minor_upgrade_behavior VARCHAR(20) NOT NULL DEFAULT 'AUTO_UPGRADE_MINOR'
    CHECK (minor_upgrade_behavior IN ('AUTO_UPGRADE_MINOR', 'PIN_CURRENT', 'MANUAL_APPROVAL')),
  ADD COLUMN last_resolved_version VARCHAR(32);
