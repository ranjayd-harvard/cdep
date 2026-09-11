-- Phase 11 (spec §18/§19/§21): field-level governance metadata, wired to
-- an actual enforcement path in data-publication-service (masking.py) and
-- data-product-api-service (response-projector.ts) — see docs/security/
-- data-classification.md.
ALTER TABLE catalog.product_schema_fields
  ADD COLUMN pii             BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN pii_type        VARCHAR(32),
  ADD COLUMN masking_policy  VARCHAR(16),
  ADD CONSTRAINT product_schema_fields_pii_type_chk CHECK (
    pii_type IS NULL OR pii_type IN (
      'NONE', 'NAME', 'EMAIL', 'PHONE', 'ADDRESS', 'DATE_OF_BIRTH',
      'GOVERNMENT_ID', 'FINANCIAL', 'LOCATION', 'DEVICE_IDENTIFIER', 'OTHER'
    )
  ),
  ADD CONSTRAINT product_schema_fields_masking_policy_chk CHECK (
    masking_policy IS NULL OR masking_policy IN ('ALLOW', 'REDACT', 'MASK', 'HASH', 'DENY')
  );
