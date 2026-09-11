# Retention, Deletion & Legal Hold

## Scope

Implemented in `data-exchange-service`, which owns the physical outbound artifact (`exchange_files.bucket_name/object_key`) and already tracked expiry (`exchanges.expires_at`/`EXPIRED` status) before Phase 11. Retention for other artifact types (inbound uploads, Bronze/Silver/Gold, operational events, audit logs) is not implemented — see "Not done" below.

## RetentionPolicy (`src/retention/retention-policy.ts`)

One policy today (`OUTBOUND_ARTIFACT_RETENTION_POLICY`), matching the spec §23 shape (`policyId`, `retentionDays`, `disposition`, `classificationScope`, `legalHoldSupported`) but deliberately not a per-classification table yet: eligibility is a pure function of the exchange's existing `direction`/`status`/`legal_hold` columns, not a separate day-count clock — `expires_at` (already set at publish time from the contract's `publication.expirationHours`) is the only expiry signal. `evaluateRetentionEligibility()` returns a typed reason (`NOT_OUTBOUND` / `NOT_EXPIRED` / `LEGAL_HOLD`) rather than a bare boolean, so the deletion service and its audit trail always know *why*.

## Deletion workflow (`src/retention/deletion.service.ts`, `deletion-request.repository.ts`)

`exchange.deletion_requests` (migration `011_retention_and_audit.sql`) tracks one row per attempt through the full state vocabulary from spec §24 (`REQUESTED → APPROVED → IN_PROGRESS → BLOCKED/COMPLETED/FAILED/CANCELLED`), though `REQUESTED`→`APPROVED`→`IN_PROGRESS` collapse into one synchronous call today (no separate human-approval step exists yet — additive to add later, not a reshape).

`POST /internal/v1/exchanges/:exchangeId/deletion-requests`:
1. Loads the exchange, creates the request row, writes `DELETION_REQUESTED`.
2. Evaluates retention eligibility. Not eligible → `BLOCKED`, writes `DELETION_BLOCKED` with the specific reason (e.g. `LEGAL_HOLD`), **does not touch the object**.
3. Eligible → deletes every `exchange_files` object via `ObjectStorage.deleteObject`, transitions the exchange to a new terminal `DELETED` status (added to `OUTBOUND_STATUSES`/`OUTBOUND_TRANSITIONS`, gated through the existing `assertValidTransition` the same way every other status change is), marks the request `COMPLETED`, writes `RETENTION_EXECUTED` + `DELETION_COMPLETED`.
4. Any storage/DB error → `FAILED`, writes `DELETION_FAILED` with the error message — never a silent partial state.

`GET /internal/v1/exchanges/:exchangeId/deletion-requests` lists the history for verification/audit.

## Legal hold (`PUT /internal/v1/exchanges/:exchangeId/legal-hold`)

Sets/clears `exchanges.legal_hold` (migration-added column). While `true`, `evaluateRetentionEligibility()` always returns `LEGAL_HOLD` regardless of expiry — a legal hold overrides automated retention/deletion exactly per spec §25, checked *before* any physical action, not merely documented.

## Audit (`src/audit/audit.repository.ts`, `exchange.security_audit_events`)

Append-only (the `app_exchange` role has INSERT+SELECT only, no UPDATE/DELETE — migration `011`). This is the first `security_audit_events` table added outside `scheduling-service`/`subscription-service`, pulled forward from M9 because the deletion workflow needed somewhere real to write evidence. Event types emitted here today: `DELETION_REQUESTED`, `DELETION_BLOCKED`, `DELETION_COMPLETED`, `DELETION_FAILED`, `RETENTION_EXECUTED`, and `ACCESS_ALLOWED` (legal-hold set/cleared).

## Tested (spec §42, mandatory)

`src/tests/integration/retention-deletion.test.ts` — two cases against a real running MinIO and Postgres, no mocks:
1. An expired outbound exchange's artifact is deleted (`headObject` confirms the object is gone), status transitions to `DELETED`, and `DELETION_REQUESTED`/`RETENTION_EXECUTED`/`DELETION_COMPLETED` all appear in `security_audit_events`.
2. The same scenario with `legal_hold: true` first: the request is `BLOCKED` with `error_message: "LEGAL_HOLD"`, the exchange stays `EXPIRED` (not `DELETED`), the artifact still exists (`headObject` confirms), and `DELETION_BLOCKED` is recorded with `reason_code: "LEGAL_HOLD"`, `decision: "DENY"`.

## Not done (tracked follow-up)

- No retention/deletion for inbound uploads, Bronze/Silver/Gold, operational events, or audit logs themselves (spec §23's full layer list).
- No `REQUESTED`→pending-human-`APPROVED` gap — a caller with internal API access can trigger deletion directly (appropriate for an internal/system-triggered retention sweep, less so for a human-initiated request that should require a second approver).
- Deletion routes are gated by this service's existing `requireInternalApiKey` (no role/permission distinction) — this service has no internal actor-role concept at all yet (unlike catalog/subscription/scheduling's `requireInternalAuth(minimumRole)`), so deletion isn't restricted to a more privileged role than any other internal caller. Tracked alongside the M4 service-identity rollout gap.
