# Phase 11 — Implementation Inventory

Read-only audit of the platform as it stands before Phase 11 work begins. Covers all 9 backend services (`data-exchange-service`, `data-lakehouse`, `data-platform-observability-service`, `data-product-api-service`, `data-product-catalog-service`, `data-publication-service`, `scheduling-service`, `serving-projection-service`, `subscription-service`) and the Next.js portal.

## Architecture already in place (reuse, don't replace)

- **Every Fastify service** (`exchange`, `catalog`, `subscription`, `scheduling`, `observability`, `product-api`) follows the same shape: `src/app.ts` → `src/auth/{auth,customer-auth,internal-auth}.middleware.ts` → route modules under `src/api/customer/*` (session-derived tenant) and `src/api/internal/*` (service-to-service, tenant passed explicitly because the caller is already trusted).
- A `SecurityContext`/`RequestContext`-shaped object already exists in every service (`src/auth/request-context.ts`), just under inconsistent names/shapes. **Unify, don't reinvent.**
- Tenant resolution on customer routes is already architecturally correct: never taken from query/body/params, always derived from the authenticated context (`data-platform-observability-service/src/api/customer/product-status.routes.ts:20-26`, `src/lib/tenant.ts` in the portal). Internal routes intentionally accept explicit `tenant_id`/`organization_id` because the caller is a pre-authenticated internal actor.
- Repository-layer tenant scoping is strong in `data-exchange-service` and `subscription-service` (mandatory positional `organizationId, tenantId` params) and strongest in `data-product-api-service` (`postgres-serving-store.ts:31-32` — `organization_id`/`tenant_id` are always the first two WHERE params, sort fields resolved through a fixed allowlist, no string-built SQL). `scheduling-service`'s `findExecutionById`/`listExecutions` are weaker (optional tenant filter fields, one app-layer post-fetch ownership check) — first fix target for TenantGuard rollout.
- `data-exchange-service` already has RLS policies defined (`exchange.exchanges`, `exchange.pipeline_jobs`) and a real signed-URL implementation (`s3-storage.adapter.ts`), storage-key builder with tenant/org embedded server-side, filename sanitization, checksum generation, and an entitlement gate before upload/download.
- `data-product-catalog-service` already has field-level `classification` (PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED) in the schema and DB, plus **unused Phase-11 columns already migrated**: `data_classification`, `retention_policy_ref`, `contains_pii`, `compliance_tags` on `catalog.data_product_versions` (`migrations/013_version_lifecycle_metadata.sql`, explicitly labeled "Phase 11 governance hooks").
- `data-publication-service` already has a contract-driven column-projection allowlist (`project_published_schema()` — only contract-listed columns ever leave Gold) and an unused masking hook (`apply_masking`: redact/hash/last4) ready to wire to PII fields.
- `data-product-api-service`'s entitlement→subscription→delivery-method chain (`event-performance-query.service.ts:requireEntitledAndSubscribed`) is solid and already collapses all denial reasons to one anti-enumeration error.
- `scheduling-service` and `subscription-service` already have real append-only audit tables (`scheduler_audit_events`, `subscription_audit_events`) — extend this pattern platform-wide rather than building a new one.
- The portal has real auth (NextAuth, bcrypt + Google OAuth) and a genuinely solid `TenantScopedCollection` Mongo wrapper that throws `TenantIsolationError` on any cross-tenant filter attempt — a good pattern to mirror server-side.

## Critical gaps Phase 11 must close

1. **No real OIDC/JWT verification anywhere.** `verifyProductionJwt()` is a stub that throws in every customer-facing service (exchange, subscription, scheduling, observability, product-api). Dev mode base64-decodes an unsigned token. This is the headline blocker.
2. **Service-to-service trust is one shared static secret plus self-asserted headers.** Every internal call sends `x-internal-api-key` (compared with plain `!==`, not constant-time) and, on TS services, self-declared `x-actor-role`/`x-actor-type`/`x-actor-id` headers that are trusted with **no cryptographic binding to the key** — anyone holding the shared key can claim `PLATFORM_ADMIN`. The key itself defaults to the literal `dev-internal-key-change-me` in every `.env.example` and every `env.ts` schema default, with no production guard analogous to the existing `AUTH_MODE=development` boot-time refusal.
3. **`data-publication-service` has zero entitlement awareness.** It trusts that whoever holds the shared internal key already checked entitlement upstream (scheduling-service does check, but a direct caller of the publication API bypasses that check entirely).
4. **RLS is inert everywhere it exists.** Enabled but not forced on 2 tables in `data-exchange-service`; no app code ever sets the `app.organization_id`/`app.tenant_id` session GUCs the policies would read; the connecting DB role owns the tables, which bypasses RLS regardless.
5. **No distinct least-privilege DB roles.** Every service connects as the same role that owns/migrates its schema (effectively `postgres`-equivalent within its own DB).
6. **Contract schema has no product/version-level governance block.** The DB columns exist (#done above) but nothing in `contract-schema.ts` or contract YAMLs can populate `dataClassification`/`containsPii`/`retentionPolicyRef`/`complianceTags` yet — greenfield wiring work.
7. **Customer-issued API keys are dead code.** The portal lets customers generate/revoke `cdep_live_...` keys; no backend service's auth middleware accepts them. Either wire in or remove the false affordance.
8. **No malware/content-sniffing scanning, no quarantine state** in `data-exchange-service` uploads — only declared content-type/extension + structural validation.
9. **Presigned PUT has no enforced size ceiling.** `completeUpload` fetches `actualSizeBytes` back but never compares it against `MAX_UPLOAD_SIZE_BYTES`.
10. **No CI pipeline at all** (`.github/workflows/` does not exist) — no automated dependency/secret/container scanning gate exists today.
11. **No SecretProvider/KeyProvider abstraction** — everything is a raw env var; hardcoded default MinIO creds (`minioadmin/minioadmin`, `lakehouse/lakehouse123`) live in compose files.
12. Audit trail exists only in `scheduling-service` and `subscription-service`; `data-exchange-service`, `data-product-catalog-service`, `data-product-api-service`, and the portal have none.
13. CORS is `origin: true` (reflect-any-origin) in every backend service; rate limiting exists only (in-memory, non-distributed) in `data-product-api-service`.

## Reuse map for Phase 11 work

| Phase 11 concept | Existing thing to extend |
|---|---|
| SecurityContext | Unify existing `RequestContext`/`SecurityContext`/`ActorContext` into one shared shape |
| Permission model | `data-exchange-service/src/auth/authorization.ts` (`Permission`, `PERMISSIONS_BY_ROLE`) — only service that has this today; generalize to all services |
| TenantGuard | `data-exchange-service`'s mandatory-positional-param repository pattern + portal's `TenantScopedCollection` |
| RLS | `data-exchange-service/migrations/004_exchanges.sql` policies — fix (FORCE + session GUC + non-owner role), then extend to other tenant tables |
| Audit | `scheduling-service`/`subscription-service` `*_audit_events` tables + `audit.repository.ts` pattern |
| Data classification / PII | `catalog.product_schema_fields.classification` + the already-migrated but unused `data_product_versions` governance columns |
| Column masking | `data-publication-service/transformations/masking.py` (`apply_masking`) — already built, unused |
| Signed URLs | `data-exchange-service/src/storage/s3-storage.adapter.ts` — already scoped/short-lived; harden PUT size enforcement |
| Service identity | Replace shared static `x-internal-api-key` + self-asserted actor headers with per-service signed credentials |
