# Phase 10 — Product Versioning & Lifecycle Management: Implementation Report

Status: all 16 steps of the approved plan implemented for real (schema,
lifecycle state machine, compatibility engine, retirement guard, dependency
model, centralized version resolver, subscription-service and
scheduling-service refactors, rollback, migration plans, customer-safe API
extensions, API Delivery explicit-version route, Publication manifest
versioning, and Observability per-version metrics), across six services,
with real Postgres migrations and 408 tests passing (zero regressions).

Verified against **actually running Phase 1–9 services on the dev
machine**, not just fixtures — every Docker container touched
(`data-product-catalog-service`, `subscription-service`,
`scheduling-service`, `data-publication-service`) was rebuilt and
restarted mid-implementation and re-tested against the others live. This
surfaced and fixed several real bugs no unit test would have caught
(§6 below), most importantly a gap the original spec itself missed.

## 1. Architecture decision (unchanged from the spec)

Phase 10 lives entirely inside `data-product-catalog-service` as new
modules under `src/modules/`: `lifecycle/`, `compatibility/` (relocated
from `src/registration/`), `migrations/`, `dependencies/`,
`impact-analysis/`, `version-resolution/`, `beta-access/`, plus new
`src/infrastructure/http/` clients and `src/infrastructure/idempotency/`.
No new microservice. `catalog.registration_events` remains the single
audit sink for every lifecycle/compatibility/migration/approval event.

## 2. Database migrations

**`data-product-catalog-service`** (`013`–`019`, all apply cleanly against
a fresh DB and re-run as a no-op): version lifecycle metadata
(`compatibility_type`, `predecessor_version`/`successor_version`,
`grace_period_end`, `activated_at`, Phase 11 governance-hook columns) ·
`version_compatibility_results` · `version_dependencies` ·
`migration_plans` + `migration_subscriptions` · `version_approvals` ·
`version_beta_opt_ins` · `idempotency_records` (net-new infra — Catalog had
none before Phase 10, unlike subscription-service).

**`subscription-service`** (`008`): widens `version_policy_type`'s CHECK
from 3 to 5 values, data-migrates existing `COMPATIBLE_MAJOR` rows to
`COMPATIBLE_MINOR` in the same transaction (identical semantics, a
rename), adds `minor_upgrade_behavior` and `last_resolved_version`.

## 3. Semantic versioning and the compatibility engine

`common/utils/semver.ts` keeps its existing loose `parseSemVer` (accepts
"1.2", used by pre-existing contracts) untouched, and adds a new strict
API — `parseSemver`, `compareSemver`, `bumpKind`, `isSameMajor`,
`isSameMajorMinor` — that every new Phase 10 module uses exclusively; no
module parses a version string itself.

`modules/compatibility/compatibility.service.ts` extends the existing
field-level schema diff with: a set-level grain-key/business-key diff
(BREAKING on any composition change, regardless of per-field diffs),
quality-contract diff (tightened or loosened — always visible, never
blocking), SLA diff (freshness/availability — `SLA_IMPROVED`/
`SLA_LOOSENED`, always non-breaking by itself), delivery-method diff
(removing a published method/API filter/sort is BREAKING, adding is
NON_BREAKING). All feed one `changes[]` array of structured
`{type, field, detail}` entries — the `version_compatibility_results` row
persisted on every evaluation (registration-time and the new
`evaluate-compatibility` dry-run endpoint) is genuinely explainable, never
a bare boolean.

Bump-vs-compatibility validation (`VERSION_BUMP_MISMATCH`,
`BREAKING_CHANGE_REQUIRES_MAJOR_VERSION`) is enforced at registration time,
already-existing logic extended to route through the new engine.

## 4. Lifecycle state machine

`modules/lifecycle/transition-rules.ts` — the explicit `ALLOWED_TRANSITIONS`
table (mirroring subscription-service's own `transition-rules.ts` shape
exactly), with `DEPRECATED -> ACTIVE` present in the table but reachable
only through the dedicated `rollbackVersion` action, never generic
`activate`.

`activateVersion` extended in place: accepts `targetStatus: "BETA" |
"ACTIVE"` (default ACTIVE) on the existing `/activate` route rather than a
new endpoint; gates on `requireApprovalIfBreaking` (a version whose latest
compatibility evaluation is BREAKING needs a `version_approvals` row before
leaving DRAFT, for either target); on activating to ACTIVE, sets
predecessor/successor lineage and a grace period (default
`DEFAULT_GRACE_PERIOD_DAYS=90`, never overwriting an already-set one) on
the superseded version.

`deprecateVersion` extended: accepts `gracePeriodDays` and
`replacementVersion`, sets `successor_version`.

`retireVersion` fully rebuilt around the retirement guard (§5) and now
uses `assertTransition` — ACTIVE can never retire directly (not even
forced; force overrides *blockers*, never the state machine), only
BETA/DEPRECATED can reach RETIRED.

`rollbackVersion` (new): un-supersedes only the immediate predecessor of
the current ACTIVE version, emits `VERSION_ROLLBACK` (never
`VERSION_ACTIVATED`), no history rewritten.

New internal routes: `evaluate-compatibility` (dry-run, persists a
compatibility result + `COMPATIBILITY_EVALUATED` event without creating a
version), `approve`, `rollback`, `beta-opt-in`.

## 5. Retirement guard (`modules/lifecycle/retirement-guard.ts`)

All six blocker checks, each independent, all run regardless of earlier
hits: active subscriptions currently resolving to this version (via the
shared resolver, real HTTP call to subscription-service's
`delivery-candidates`), scheduled non-terminal executions (real HTTP call
to scheduling-service, client-side version filter — its listing has none
server-side), active/in-flight publications (real HTTP call to
data-publication-service, same client-side-filter caveat), dependent
products whose declared range still covers this version (in-catalog,
`version_dependencies`), grace-period-not-complete. "API consumers" folds
into the active-subscriptions check per the spec's own correction
(data-product-api-service has no internal API to query).

Blocked retirement returns a structured `blockers[]` array in the error
response (`RetirementBlockedError`, the one deliberate addition to the
otherwise-flat `{code, message, correlationId}` error envelope) and
records `VERSION_RETIREMENT_BLOCKED`. `force=true` requires a non-empty
`reason` and strictly `PLATFORM_ADMIN` (checked in-service, not just at
the route's minimum-role gate).

Verified with real HTTP calls to all three live sibling containers,
including a genuine empty-result path (fresh test product, zero
cross-service state) and a real dependency-blocked retirement.

## 6. The critical fix the original spec missed

The spec's own text asserted `scheduling-service` "needs zero changes" for
Phase 10 (§30/§31 of `docs/phase10-implementation-prompt.md`). Verification
found this false: `scheduling-service/src/infrastructure/http/
catalog-http-client.ts` independently called Catalog directly with its own
duplicate, 3-policy-type ranking algorithm — the actual delivery-time
decision point — while `subscription-service`'s already-resolved
`resolvedProductVersion` (fetched into the same DTO) was never read.
Fixing only subscription-service's copy would have left the scheduler
silently diverging from the new centralized resolver at exactly the point
that matters most.

Fixed as part of Step 8: `catalog-http-client.ts`'s `resolveVersionPolicy`
now calls Catalog's `resolve-version` endpoint with `intent: "DELIVER"`
(new internal-auth-header support added to this client — it only ever
called public routes before); `lifecycle-policy.ts`'s
`isLifecyclePublishable` narrowed to a DRAFT/RETIRED-only defensive check,
trusting the resolver for everything else. A new cross-service e2e test
(`scheduling-service/src/tests/e2e/phase10-version-resolution.test.ts`)
proves the fix: it asks Catalog's resolver directly what a
`COMPATIBLE_MINOR("1")` policy should resolve to, then triggers a real
`ExecutionProcessor.run()` pipeline via scheduling-service's manual-trigger
endpoint and asserts the scheduler's `resolved_product_version` matches
exactly.

Other deltas found and fixed during implementation (all documented inline
in the relevant files' comments):
- Migration `019`'s planned `ALTER TABLE ... DROP/ADD CONSTRAINT` on
  `registration_events.event_type` was based on a spec assumption that
  turned out wrong — no such DB constraint exists, only a TypeScript
  const array. Migration `019` was repurposed for the idempotency table
  instead; only the TS array needed the 8 new entries.
- `data-product-api-service`'s route is a hardcoded literal
  (`/v1/data-products/event-performance/events`), not a generic
  `/:productId/:resource` — the explicit-version route was added as a
  sibling literal route matching that convention exactly.
- `data-publication-service`'s example fixture contract
  (`event-performance-v1.1.0.yaml`) was missing its `api:` delivery config
  block entirely — harmless under pre-Phase-10 rules, but the new
  delivery/API-filter compatibility diff correctly flagged it as
  BREAKING. Fixed the fixture (restoring the filters it always should
  have carried forward) rather than weakening the new check.
- `PINNED_MAJOR` vs `COMPATIBLE_MINOR` have no distinguishing wire-format
  string (both store `value = MAJOR`); resolved by requiring the
  structured `{type: "PINNED_MAJOR", value}` form for that one type,
  keeping the existing `"1.x"` shorthand mapped to `COMPATIBLE_MINOR` only.
- The customer-safe version list/detail routes (`listCustomerVersions`/
  `getCustomerVersionDetail`) did **not** already filter DRAFT, despite a
  code comment claiming they did. Fixed: both now filter to
  ACTIVE/DEPRECATED/RETIRED only, BETA deliberately excluded too (public
  route has no tenant context to check an opt-in against).

## 7. Version dependency model and impact analysis

`modules/dependencies/` — `declareDependency` validates the referenced
product exists and min/max parse as strict semver (does not require any
version in the range to exist yet). `modules/impact-analysis/` —
`computeImpact` resolves every subscription's *currently stored* policy
against current catalog state (DELIVER intent) and buckets into
resolvesToFrom/resolvesToTo/pinnedToFrom/betaOptedIn, matching the
required worked-example shape; `requiresExplicitAction` = pinnedToFrom
(EXACT-pinned subscriptions never auto-move).

## 8. The central version resolver (`modules/version-resolution/resolver.ts`)

The single shared implementation of all five policy types
(EXACT/COMPATIBLE_PATCH/COMPATIBLE_MINOR/PINNED_MAJOR/LATEST_ACTIVE) × two
intents (SUBSCRIBE/DELIVER). SUBSCRIBE sees ACTIVE-only candidates for
floating policies; DELIVER also sees DEPRECATED (grace-period riding).
LATEST_ACTIVE never falls back to DEPRECATED under any intent. EXACT
resolves any status except DRAFT (never) and RETIRED (fails closed,
`VERSION_RETIRED_UNRESOLVABLE`); BETA requires a `version_beta_opt_ins`
row. An optional `preferredVersion` hint (stateless resolver, caller
supplies the subscription's `last_resolved_version`) implements
PIN_CURRENT/MANUAL_APPROVAL semantics.

`subscription-service`'s `catalog-client.ts` and `scheduling-service`'s
`catalog-http-client.ts` both became thin wrappers on
`POST /internal/v1/data-products/:productId/resolve-version` — their local
ranking algorithms deleted, not duplicated.

## 9. Migration plans (`modules/migrations/`)

`createMigration`: server computes `fromVersion` (current canonical
ACTIVE at plan-creation time — the realistic order is "plan the cutover
while still on the old version, then activate the new one, then
execute"), `compatibility` (latest persisted evaluation for the pair),
and snapshots affected subscriptions into `migration_subscriptions`
(PENDING), all idempotency-key-protected (new `catalog.idempotency_records`
infra, ported from subscription-service's shape).

`executeMigration`: NON_BREAKING plans auto-move each PENDING
subscription by calling a **new internal endpoint added to
subscription-service** (`POST /internal/v1/subscriptions/:id/
version-policy`, PLATFORM_ADMIN-gated, the one system-driven write path
Catalog uses instead of touching Subscription's table directly).
BREAKING plans reject (`MIGRATION_REQUIRES_MANUAL_ACTION`) unless every
subscription has already been moved individually.

Verified end-to-end against the real subscription-service container: a
real EXACT-pinned subscription was actually moved from `1.0.0` to `1.1.0`
via the migration executor and confirmed via a follow-up read against
subscription-service's own API.

## 10. Customer-safe API, API Delivery, and Publication

`toCustomerVersionSummary`/`Detail` gained `compatibility`, `releasedAt`,
`deprecationDeadline` (only when DEPRECATED), `successorVersion`.

`data-product-api-service` gained
`GET /v1/data-products/event-performance/versions/:version/events`
alongside the existing default-resolved route — calls Catalog's resolver
directly with EXACT/DELIVER (not the subscription's stored floating
policy), while still requiring the same entitlement + active-API-
subscription gate as the default route (naming a version in the URL never
bypasses entitlement).

`data-publication-service`: `ArtifactResult` gained `product_version`;
both exporters embed it (Parquet as file-level key-value metadata, both
formats via a new uniform sidecar `<filename>.manifest.json` —
`exporters/manifest.py`). Publication Service's existing "no lifecycle
check, trust the resolved version verbatim" behavior was confirmed
unchanged (§40's expected defensive check needed no code change — there
was no restrictive check to relax).

## 11. Observability per-version metrics

New `application/services/version-adoption.service.ts`: per-version
adoption computed from this service's own already-collected execution
data (distinct correlated `subscription_id`s in a 30-day window) — an
activity proxy, documented as such, chosen over adding a new bulk
subscription-listing integration. `getDeprecatedVersionUsage` isolates
DEPRECATED-version activity specifically. `getMigrationsRemaining` is a
thin read-only passthrough of Catalog's migration plans (never
recomputed). Three new internal routes:
`GET .../versions/:version/health` (mirrors the existing `?product_version=`
filter one level deeper in the URL), `GET .../versions/adoption`,
`GET .../versions/deprecated-usage`, `GET .../migrations-remaining`.

## 12. What's intentionally partial

- `MANUAL_APPROVAL` upgrade behavior implements the "keep returning the
  last-resolved version until moved" half correctly (via the
  `preferredVersion` hint) but does not independently gate on an existing
  `version_approvals` row before switching off the hint — the resolver
  stays stateless per spec; a full implementation would need the caller
  (subscription-service) to check for an approval itself before dropping
  the hint. Documented in `subscription.service.ts`.
- Observability's adoption metric is an activity proxy (recent execution
  volume), not a live subscription count — a live count would require a
  new bulk-listing integration into subscription-service from
  Observability, deliberately deferred as lower-value than the rest of
  this phase.
- Phase 11 governance-hook columns (`data_classification`,
  `retention_policy_ref`, `contains_pii`, `compliance_tags`) exist,
  nullable, unenforced — exactly as scoped.

## 13. Test results (all real, run against live sibling containers where cross-service)

| Service | Tests | Notes |
|---|---|---|
| `data-product-catalog-service` | 103/103 | +62 new (compatibility, transition-rules, resolver, retirement-guard, migration-plan, rollback, version-lifecycle) |
| `subscription-service` | 71/71 | version-policy rename, resolver refactor, contract test against live Catalog |
| `scheduling-service` | 68/68 | +1 new cross-service e2e; 3 leader-elector tests require the service's own container stopped (pre-existing, unrelated to Phase 10 — the container holds the same Postgres advisory lock) |
| `data-product-api-service` | 62/62 | +4 new (explicit-version query function) |
| `data-platform-observability-service` | 85/85 | +2 new (version adoption) |
| `data-publication-service` (Python) | 20/20 | +2 new (manifest, version metadata) |
| **Total** | **408/408** | zero regressions |

One pre-existing test-isolation gap was found and fixed as a side effect
of running the full suite repeatedly during development: a search-by-name
test in `registration-flow.test.ts` used a shared literal product name
across every test run, which crossed the default pagination limit after
~20 accumulated historical runs. Fixed to search by a per-run-unique name
instead of relying on periodic manual DB truncation.

## 14. Local development

No new services, no new containers/ports. Catalog's `docker-compose.yml`
gained the three sibling-client env vars (`SUBSCRIPTION_SERVICE_URL`,
`SCHEDULING_SERVICE_URL`, `PUBLICATION_SERVICE_URL`, via
`host.docker.internal` to reach the other services' own compose projects)
plus `DEFAULT_GRACE_PERIOD_DAYS`. All four touched Docker images
(`data-product-catalog-service`, `subscription-service`,
`scheduling-service`, `data-publication-service`'s `api` and `runner`)
were rebuilt and restarted during implementation and are running the
Phase 10 code as of this report.
