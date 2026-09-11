# Data Classification & Column Policy

## Classification and PII metadata (implemented)

`data-product-catalog-service`'s contract schema (`src/registration/contract-schema.ts`) now supports, per field:

```yaml
- name: customer_email
  classification: RESTRICTED   # PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  pii: true
  piiType: EMAIL                # spec §19's fixed vocabulary
  customerVisible: false
  maskingPolicy: DENY           # ALLOW | REDACT | MASK | HASH | DENY
```

and per product version (`spec.governance`):

```yaml
governance:
  dataClassification: RESTRICTED
  retentionPolicyRef: CUSTOMER_PII_90_DAYS
  complianceTags: [contains-pii]
```

This populates the DB columns already migrated ahead of Phase 11 (`catalog.data_product_versions.data_classification/retention_policy_ref/contains_pii/compliance_tags`, `catalog.product_schema_fields.pii/pii_type/masking_policy` — the last three added by `migrations/020_field_governance.sql`). `contains_pii` is derived from the schema (`true` if any field has `pii: true`), never separately author-declared, so it can't drift from the fields actually marked.

**Registration validation (spec §20)** — `registration.validator.ts` rejects a contract at registration time (before it ever becomes ACTIVE) when a field is `classification: RESTRICTED` and:
- has no `piiType`, or
- has no `maskingPolicy`, or
- is `customerVisible: true` with `maskingPolicy: ALLOW` (a RESTRICTED field must be masked/redacted/hashed/denied, or explicitly hidden), or
- the product version has no `governance.retentionPolicyRef` set anywhere a RESTRICTED field exists.

Covered by `src/tests/unit/registration.validator.test.ts` (5 new cases).

## Column policy enforcement — FILE and API delivery (implemented, same rule both places)

A field is **excluded entirely** from a published artifact when `customerVisible: false` OR `maskingPolicy: DENY` — DENY always wins even if an author left `customerVisible` at its default `true`, so a RESTRICTED+DENY field can't leak through an oversight.

A field that **is** published gets transformed per `maskingPolicy`:

| Catalog policy | FILE (`data-publication-service/transformations/masking.py`) | API (`data-product-api-service/domain/response-projector.ts`) |
|---|---|---|
| `REDACT` | `"***REDACTED***"` | `"***REDACTED***"` |
| `HASH` | SHA-256 hex | SHA-256 hex |
| `MASK` | mapped to the existing `last4` strategy | last 4 characters, `***`-prefixed |
| `ALLOW` / unset | passed through unchanged | passed through unchanged |

Both delivery methods read the **same** Catalog-authored field metadata (`data-publication-service/contracts/loader.py`'s `_merge_catalog_contract`, `data-product-catalog-service/modules/versions/version.service.ts`'s `getApiContract`) — there is no separate, hand-authored masking config to drift out of sync. `data-publication-service`'s previously-unused `masking.py` hook (built in an earlier phase, never wired to anything) is now actually driven by this.

Tested: `data-publication-service/tests/unit/test_contract_loader.py` (existing, still green), `data-product-api-service/src/tests/unit/response-projector.test.ts` (new masking case).

## Entitlement re-validation before publish (implemented)

`data-publication-service` previously had no entitlement check of its own — the Phase 11 inventory flagged that a direct caller of its internal publish API could bypass scheduling-service's entitlement gate entirely. `publication_service.py`'s `publish()` now calls the same `/internal/v1/entitlements/evaluate` endpoint scheduling-service already used, fails closed (DENY) if subscription-service is unreachable or unconfigured, and the API route maps a denial to `403 ENTITLEMENT_DENIED` rather than an unhandled 500.

## Known gap: no physical PII field flows through the live pipeline

The mandatory governance leakage test (spec §41) describes proving `customer_email` cannot leak through CSV/Parquet/JSON API/logs/audit when it exists in **Gold**. This platform's actual Gold/Silver/serving-store schemas for `event-performance` do not contain a `customer_email` column, and adding one for real would mean touching the lakehouse pipeline, the serving-projection schema, and the serving store across three more services — out of scope for this pass.

What Phase 11 *does* prove, with passing tests, is the governance-metadata path in full: a RESTRICTED+PII+customerVisible:false field (`contracts/examples/event-performance-v2.1.0-governance-demo.yaml`) is rejected or accepted by registration validation correctly, and — if it existed in a served row — would be excluded by both delivery methods' contract-driven projection logic, which is unit-tested directly against synthetic rows in both services. Wiring an actual physical column through the full pipeline to turn this into a true end-to-end integration test is tracked as follow-up work, not done in this pass.
