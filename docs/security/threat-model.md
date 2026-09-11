# Threat Model (STRIDE)

Concise, implementation-grounded — each entry names the actual control that exists today, and honestly marks residual risk where the control is partial.

## Spoofing

| Threat | Asset | Attack path | Preventive control | Detective control | Test | Residual risk |
|---|---|---|---|---|---|---|
| JWT forgery | Customer identity | Attacker crafts an unsigned/self-signed token | `jose.jwtVerify` against Keycloak JWKS, RS256-only, iss/aud/exp checked | `ACCESS_DENIED`/auth-failure logging (structured, not yet a dedicated LOGIN_FAILURE event everywhere) | New auth tests per service (expired/wrong-iss/wrong-aud cases — tracked, not all written this pass) | Low in `AUTH_MODE=oidc`; dev-mode fallback (unsigned base64 decode) remains reachable if `AUTH_MODE=development` is left set — closed by the existing prod boot guard, not by removing the dev path |
| Service impersonation | Inter-service trust | Attacker with network access claims to be another service | Signed, short-lived (60s) service-identity JWT (`security/service-identity.ts`), verified server-side | `ACCESS_DENIED` audit event on role-check failure (catalog-service) | None dedicated yet | **Medium** — only the subscription-service callee is migrated; ~14 other caller/callee pairs still accept the legacy static-key + self-declared role header outside production |

## Tampering

| Threat | Asset | Attack path | Preventive control | Detective control | Test | Residual risk |
|---|---|---|---|---|---|---|
| Cross-tenant row mutation | Tenant data | A bug omits a tenant filter on an UPDATE | Mandatory leading `organizationId`/`tenantId` repository params (structural, not just convention) | `phase8-tenant-isolation.test.ts` | Passing | Low for the audited services; RLS as a second layer is prepared but not load-bearing (see tenant-isolation.md) |
| Storage path traversal | Object storage | Attacker-supplied filename with `../` | `sanitizeFilename()` allowlist regex; keys otherwise fully server-generated | — | Existing filename tests | Low |
| Oversized upload bypassing declared size | Storage/cost | Client PUTs more bytes than declared at initiate-time | Post-upload real-size check against `MAX_UPLOAD_SIZE_BYTES`, oversized object deleted immediately | `VALIDATION_FAILED` exchange event | Not covered by an automated test this pass (5 GiB default makes a fast test impractical) | Low-medium — logic exists, untested at the real threshold |

## Repudiation

| Threat | Asset | Attack path | Preventive control | Detective control | Test | Residual risk |
|---|---|---|---|---|---|---|
| Audit tampering | Audit trail | An app bug or compromised app credential rewrites history | `app_exchange` role has INSERT+SELECT only on `security_audit_events`, no UPDATE/DELETE grant | — | Migration verified applied | Low for `data-exchange-service`; `catalog.security_audit_events` has no DB-level append-only enforcement yet (no distinct role there) |
| Deletion without evidence | Deletion workflow | A deletion happens with no record of who/why | Every branch of `deletion.service.ts` writes an audit event before returning | `retention-deletion.test.ts` asserts audit rows exist | Passing | Low |

## Information Disclosure

| Threat | Asset | Attack path | Preventive control | Detective control | Test | Residual risk |
|---|---|---|---|---|---|---|
| RESTRICTED/PII field leakage | Customer PII | A field marked RESTRICTED reaches FILE or API output | Contract-driven exclusion (customerVisible/DENY) + REDACT/HASH/MASK, identical in both delivery paths | `CONTRACT_POLICY_VIOLATION` audit on rejected registration | `security-audit.test.ts`, `response-projector.test.ts` masking case | **Medium** — enforcement logic is unit-tested; no live PII column exists in Gold/serving-store to prove the full physical pipeline (see data-classification.md) |
| Cross-tenant read | Tenant data | Object ID/subscription ID guessing, IDOR | Mandatory tenant-scoped repository lookups; existence never confirmed for another tenant (404, not 403) | `phase8-tenant-isolation.test.ts` | Passing | Low |
| Signed URL leakage | Object storage | A leaked signed URL grants access indefinitely | 300–900s TTL, object-specific, never logged (pino redact) | `SIGNED_URL_CREATED` audit event type defined but not yet emitted everywhere it should be | Not directly tested this pass | Medium — short TTL bounds the blast radius, but emission of the audit event isn't wired at every issuance point |
| Internal error detail leakage | Any | Stack trace/SQL/host in a customer-facing error | Existing `AppError`/`STATUS_BY_CODE` pattern, pre-Phase-11 | — | Existing error-shape tests | Low |

## Denial of Service

| Threat | Asset | Attack path | Preventive control | Detective control | Test | Residual risk |
|---|---|---|---|---|---|---|
| API abuse / scraping | `data-product-api-service` | High-volume querying | In-memory rate limiter (pre-existing) | — | — | **Medium-high** — in-memory limiter doesn't hold across replicas; not addressed this phase |
| Upload flooding | `data-exchange-service` | Many large uploads | `MAX_UPLOAD_SIZE_BYTES` + entitlement gate before any object is created | — | — | Medium — no request-rate limiting on upload initiation itself |

## Elevation of Privilege

| Threat | Asset | Attack path | Preventive control | Detective control | Test | Residual risk |
|---|---|---|---|---|---|---|
| Self-asserted role escalation | Internal API | Holder of shared static key sets `x-actor-role: PLATFORM_ADMIN` | Signed service-identity token carries the role inside a verified payload (migrated relationship only) | `ACCESS_DENIED` on role mismatch | None dedicated | **Medium** — only subscription-service's callee path closes this; the legacy header path remains valid (non-production) for ~14 other relationships |
| Governance bypass via contract omission | Data classification | Author simply omits `pii`/`maskingPolicy` on a sensitive field | Registration validator rejects RESTRICTED fields missing governance metadata | `CONTRACT_POLICY_VIOLATION` audit | `registration.validator.test.ts` | Low for RESTRICTED fields; nothing forces an author to mark a field RESTRICTED in the first place — this is a metadata *discipline* the platform enforces once claimed, not a content-scanning system that infers sensitivity automatically (explicitly out of scope per spec §19) |
| Configuration downgrade | Production auth | Operator accidentally deploys with `AUTH_MODE=development` or default secrets | Boot-time fail-closed check in every `env.ts` | `security:release-gate` script checks this statically | `npm run security:release-gate` | Low |

## Platform-specific threats not covered above

- **JWT manipulation** — covered under Spoofing/Information Disclosure.
- **Contract manipulation** — covered under Elevation of Privilege (governance bypass) and Tampering.
- **API enumeration** — anti-enumeration discipline (uniform 404s) exists in `data-product-api-service` and `data-exchange-service`; not audited across every route this phase.
- **Service credential theft** — the shared static internal-API-key remains the actual secret in most relationships (see service-identities.md); theft of it still grants broad internal access outside the one migrated relationship. This is the single highest-priority item for a follow-up pass.
