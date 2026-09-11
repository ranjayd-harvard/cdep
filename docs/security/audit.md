# Security & Governance Audit

## Model (spec §28)

Three distinct event families are kept separate, as the spec requires — this phase does not collapse them:

- **Operational events** — Phase 9's existing `operational_events`/`scheduler_audit_events`-adjacent execution tracking. Unchanged.
- **Security audit events** — who accessed or changed a protected resource. New in Phase 11 (`*.security_audit_events` tables).
- **Governance events** — policy/classification/retention actions. Modeled as specific `event_type` values inside the same security audit table (`CONTRACT_POLICY_VIOLATION`, `RETENTION_EXECUTED`, `DELETION_*`), not a fourth table — the spec's list of event types (§29) mixes both concerns in one vocabulary, and every service already had exactly one place to record "something security/governance-relevant happened."

## Coverage

| Service | Append-only audit table | Grant | Event types emitted |
|---|---|---|---|
| `scheduling-service` | `scheduler_audit_events` (pre-existing) | — | execution lifecycle events |
| `subscription-service` | `subscription_audit_events` (pre-existing) | — | entitlement/subscription lifecycle events |
| `data-exchange-service` | `security_audit_events` (Phase 11) | `app_exchange`: INSERT+SELECT only, no UPDATE/DELETE | `DELETION_REQUESTED`, `DELETION_BLOCKED`, `DELETION_COMPLETED`, `DELETION_FAILED`, `RETENTION_EXECUTED`, `ACCESS_ALLOWED` |
| `data-product-catalog-service` | `security_audit_events` (Phase 11) | none yet (no least-privilege role exists for this service — see [tenant-isolation.md](tenant-isolation.md)) | `ACCESS_DENIED` (internal role-check failure), `CONTRACT_POLICY_VIOLATION` (governance validation rejection) |
| `data-product-api-service` | none | — | — |
| `data-platform-observability-service` | none (has operational events only) | — | — |
| portal | none (has `exchanges`/API-key CRUD as operational records only) | — | — |

Every table added this phase is genuinely append-only where a least-privilege role exists to enforce it (`app_exchange` has no UPDATE/DELETE grant); `catalog.security_audit_events` is append-only by convention only today (no distinct DB role yet enforces it at the database layer), tracked as the same gap M5 already documents.

## What's tested

- `data-exchange-service/src/tests/integration/retention-deletion.test.ts` — proves `DELETION_REQUESTED`/`RETENTION_EXECUTED`/`DELETION_COMPLETED` and `DELETION_BLOCKED` (with `reason_code: LEGAL_HOLD`, `decision: DENY`) are actually written, not just theoretically wired.
- `data-product-catalog-service/src/tests/integration/security-audit.test.ts` — proves a rejected RESTRICTED-field contract writes a `CONTRACT_POLICY_VIOLATION` row with `decision: DENY` and the specific rejection reason.

## Not done (tracked follow-up)

- `data-product-api-service` has no audit table of its own — it deliberately never writes to its own serving-store pool (documented invariant: "never runs migrations and never writes rows"), so a genuine audit trail for it needs either a small dedicated store or a write path to another service's audit table. Not implemented this pass.
- The portal (Next.js/Mongo) has no security audit collection — its `exchanges`/API-key records are operational, not security audit, records. Different stack, not touched this pass.
- `ROLE_CHANGED`, `ENTITLEMENT_CHANGED`, `SIGNED_URL_CREATED` (beyond the one place it's already logged structurally), `LOGIN_SUCCESS`/`LOGIN_FAILURE`, and `RESTRICTED_FIELD_BLOCKED` from the full §29 vocabulary are not yet emitted anywhere — the events wired this phase are the ones directly produced by the M8/M9 work (deletion/retention/contract governance), not an exhaustive sweep of every call site in the platform.
