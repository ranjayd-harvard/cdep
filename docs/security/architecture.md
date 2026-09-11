# Security Architecture

## Defense-in-depth chain (as implemented)

```text
Keycloak (OIDC)
      ↓  signed JWT (RS256)
jose.jwtVerify — signature, iss, aud, exp, nbf, alg allowlist
      ↓
SecurityContext (organizationId, activeTenantId, roles[], authenticationMethod)
      ↓
RBAC — requirePermission(ctx, permission)
      ↓
Entitlement — subscription-service's evaluate() re-checked fresh at every
              consumption point (create subscription, scheduled dispatch,
              API query, FILE publish)
      ↓
Subscription / delivery-method check
      ↓
Data Product Contract (Catalog) — classification/pii/maskingPolicy per field
      ↓
Row filter — organization_id/tenant_id mandatory leading repository params
      ↓
Column policy — REDACT/HASH/MASK/DENY, identical in FILE and API delivery
      ↓
Response
      ↓
Security/governance audit event (append-only)
```

No single layer is trusted alone. A verified JWT establishes identity, not data access — entitlement, subscription, and contract-level checks are independently re-evaluated on every request, matching the spec's explicit requirement that "a successful login does NOT imply data access."

## Component map

| Component | Where |
|---|---|
| Identity provider | `identity-provider/` (Keycloak, local) |
| JWT verification | `src/auth/{auth,customer-auth}.middleware.ts` in 5 customer-facing services |
| Permission model | `src/auth/authorization.ts` in all 6 backend TS services |
| Service identity | `src/security/service-identity.ts` (mint/verify short-lived signed tokens) |
| Entitlement | `subscription-service` (authoritative), called from scheduling-service, data-product-api-service, data-publication-service |
| Contract/governance metadata | `data-product-catalog-service` (authoritative — no second registry) |
| Column policy enforcement | `data-publication-service/transformations/masking.py` (FILE), `data-product-api-service/domain/response-projector.ts` (API) |
| Tenant row filtering | Per-service repositories, mandatory `organizationId`/`tenantId` leading params |
| Retention/deletion/legal hold | `data-exchange-service/src/retention/` |
| Security audit | `*.security_audit_events` tables (`data-exchange-service`, `data-product-catalog-service`) |
| Production release gate | `scripts/security/release-gate.ts` |

## What Phase 12 (AWS/GCP) needs to map

Business services contain no cloud-specific authorization logic today. The seams Phase 12 maps to cloud infrastructure:

- **IdentityProvider**: Keycloak → Cognito/Entra ID/Okta/Auth0 — only `OIDC_ISSUER_URL`/`OIDC_JWKS_URI`/`OIDC_AUDIENCE` change.
- **SecretProvider**: raw env vars today → AWS Secrets Manager / GCP Secret Manager (see [encryption-secrets.md](encryption-secrets.md)).
- **ServiceIdentityProvider**: HMAC-signed short-lived tokens today → workload identity / mTLS / IAM roles (`src/security/service-identity.ts`'s `mintServiceToken`/`verifyServiceToken` shape stays the interface).
- **ObjectStorageProvider**: MinIO (S3-compatible) today → real S3/Cloud Storage — `ObjectStorage` interface in `data-exchange-service/src/storage/storage.interface.ts` already storage-agnostic.
- **KeyProvider**: not implemented this phase (see [encryption-secrets.md](encryption-secrets.md)) — maps to KMS/Cloud KMS.
- **AuditSink**: Postgres tables today → could additionally fan out to CloudTrail/EventBridge or Cloud Logging without changing the emission call sites, since `recordSecurityAuditEvent()` is already the single write path per service.
