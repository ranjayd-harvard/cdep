-- Phase 10 §6: version-level lifecycle metadata that the Phase 5 table
-- didn't need yet — compatibility classification, predecessor/successor
-- lineage, grace periods, and Phase 11 governance hook columns (nullable,
-- never enforced or read by any Phase 10 logic).
--
-- `breaking_change` (Phase 5) stays alongside the new `compatibility_type`
-- rather than being replaced by it: existing code/tests read
-- `breaking_change` directly, and the two are always written together
-- (breaking_change = compatibility_type = 'BREAKING') by the compatibility
-- engine, never independently.
--
-- `activated_at` is distinct from the existing `effective_from`:
-- `effective_from` is the business-facing "as of" timestamp, `activated_at`
-- is the literal state-transition timestamp recorded by lifecycle.service.ts.
ALTER TABLE catalog.data_product_versions
  ADD COLUMN compatibility_type   VARCHAR(16)  NOT NULL DEFAULT 'NON_BREAKING'
      CHECK (compatibility_type IN ('METADATA_ONLY', 'NON_BREAKING', 'BREAKING')),
  ADD COLUMN predecessor_version  VARCHAR(32),
  ADD COLUMN successor_version    VARCHAR(32),
  ADD COLUMN grace_period_end     TIMESTAMPTZ,
  ADD COLUMN migration_required   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN activated_at         TIMESTAMPTZ,
  -- Phase 11 governance hooks — columns only, no Phase 10 enforcement.
  ADD COLUMN data_classification  VARCHAR(32),
  ADD COLUMN retention_policy_ref VARCHAR(128),
  ADD COLUMN contains_pii         BOOLEAN,
  ADD COLUMN compliance_tags      JSONB        NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: every version that is already ACTIVE, DEPRECATED, or RETIRED
-- was activated at some point in the past. Best-effort backfill from the
-- existing effective_from (the closest timestamp Phase 5 already recorded)
-- rather than leaving activated_at NULL for pre-Phase-10 rows.
UPDATE catalog.data_product_versions
   SET activated_at = effective_from
 WHERE lifecycle_status IN ('ACTIVE', 'DEPRECATED', 'RETIRED')
   AND effective_from IS NOT NULL
   AND activated_at IS NULL;

CREATE INDEX product_versions_compatibility_idx ON catalog.data_product_versions (compatibility_type);
