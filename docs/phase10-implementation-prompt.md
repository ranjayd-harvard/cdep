# PHASE 10 — Product Versioning & Lifecycle Management

## Implementation prompt for Claude/Codex

This is the full implementation prompt for Phase 10. It assumes Phases 1–9
are complete and running as described in `AGENTS.md` and the Phase 5–9
implementation reports under `docs/`. Read this document in full before
writing any code. Numbered points (`§1`, `§2`, ...) are the authoritative
spec references — use them in code comments exactly like `data-product-
catalog-service` already does for Phase 5 (`spec §20`, `spec §56`, etc.), so
future phases can cite Phase 10 decisions the same way.

Before starting, read:

- `data-product-catalog-service/src/registration/lifecycle.service.ts`
- `data-product-catalog-service/src/registration/compatibility.ts`
- `data-product-catalog-service/src/config/constants.ts`
- `data-product-catalog-service/src/modules/versions/*`
- `data-product-catalog-service/migrations/004_product_versions.sql` and `011_registration_events.sql`
- `subscription-service/src/domain/version-policy.ts`
- `subscription-service/src/infrastructure/catalog-client/catalog-client.ts`
- `scheduling-service/src/infrastructure/http/subscription-http-client.ts`
- `data-publication-service/src/publication/api/schemas.py`

Phase 10 is an **extension of existing Phase 5 code**, not a rewrite. The
lifecycle statuses (`DRAFT/BETA/ACTIVE/DEPRECATED/RETIRED`), the
compatibility levels (`METADATA_ONLY/NON_BREAKING/BREAKING`), the
`activateVersion/deprecateVersion/retireVersion` functions, the
`registration_events` audit log, and the `/internal/v1/data-products/
:productId/versions/:version/{activate,deprecate,retire}` endpoints already
exist and already match this phase's target vocabulary. Do not recreate
them under new names. Extend them in place.

---

## 1. Scope decision — extend Catalog Service, do not create a new service

**§1.** Phase 10 lives inside `data-product-catalog-service`, as a set of
new/expanded modules under `src/modules/`. Do not create a
`data-product-lifecycle-service`. Rationale, specific to this codebase:

- Catalog already owns `data_product_versions`, `registration_events`,
  the semver util (`common/utils/semver.ts`), the compatibility engine, and
  the lifecycle transition functions. A separate service would either
  duplicate this state (drift risk) or turn Catalog into a thin CRUD layer
  behind a second service that re-implements the same authority Catalog
  already has — the exact anti-pattern `AGENTS.md`'s port/adapter
  discipline (`ports/*.port.ts` in `scheduling-service`) exists to avoid.
- The `004_product_versions.sql` migration comment *already anticipates
  this*: "Parallel major versions ... are a deliberate Phase 6+ extension."
  Phase 10 is that extension, staying inside the same table.
- Every other phase that touched cross-cutting concerns (Phase 6
  entitlements, Phase 7 scheduling policy, Phase 9 observability) either
  extended an existing service or added one new service with a clearly
  distinct data-ownership boundary (executions, operational events). Phase
  10 has no data of its own that Catalog doesn't already own — it is
  entirely about the *lifecycle and compatibility rules of versions Catalog
  already stores*.

**§2.** Target module layout (new directories in **bold**):

```
data-product-catalog-service/
  src/
    modules/
      versions/                    # existing — extend version.service.ts, version.routes.ts
      **lifecycle/**                # NEW — relocated + expanded registration/lifecycle.service.ts
      **compatibility/**            # NEW — relocated + expanded registration/compatibility.ts
      **migrations/**               # NEW — migration plans (product-version migrations, not DB migrations)
      **dependencies/**             # NEW — version_dependencies
      **impact-analysis/**          # NEW — subscription impact analysis
      **version-resolution/**       # NEW — the one shared version resolver
      **beta-access/**              # NEW — BETA opt-in tenants
```

`src/registration/lifecycle.service.ts` and `src/registration/
compatibility.ts` move to `src/modules/lifecycle/lifecycle.service.ts` and
`src/modules/compatibility/compatibility.service.ts` respectively (update
all imports — `version.routes.ts`, `registration.service.ts`). This is a
pure relocation for the existing logic, done first, before adding new
behavior, so the diff for behavioral changes stays reviewable separately
from the diff for the move.

The name "migrations" is overloaded in this repo (SQL migrations live in
`data-product-catalog-service/migrations/*.sql`). `modules/migrations/` here
refers exclusively to **product-version migration plans** (§17–§20 below).
Name the module's files `migration-plan.*`, never bare `migration.*`, to
keep this unambiguous in imports and logs.

---

## 2. Semantic versioning

**§3.** `common/utils/semver.ts` already exists (Phase 5) — read it before
writing anything new. It already classifies a version bump. Extend it, do
not replace it. Required shape after extension:

```ts
export interface SemverParts { major: number; minor: number; patch: number; }
export function parseSemver(version: string): SemverParts;   // throws on non-semver
export function compareSemver(a: string, b: string): number; // -1/0/1
export function bumpKind(from: string, to: string): "MAJOR" | "MINOR" | "PATCH" | "SAME" | "INVALID";
export function isSameMajor(a: string, b: string): boolean;
export function isSameMajorMinor(a: string, b: string): boolean;
```

**§4.** Versions are always full `MAJOR.MINOR.PATCH` (no `1.2`, no `v1.2.0`
prefix) — this already matches the existing `EXACT_RE = /^\d+\.\d+\.\d+$/`
in `subscription-service/src/domain/version-policy.ts` and the
`product_versions_unique UNIQUE (data_product_id, version)` constraint.
Keep it that way; do not introduce pre-release/build-metadata suffixes
(`-beta.1`, `+build5`) — the lifecycle status column already expresses
"beta", so a parallel string convention would be a redundant, driftable
second source of truth.

**§5.** `bumpKind` alone does **not** determine `compatibility_type` —
compatibility is a property of the *contract diff*, computed by the
compatibility engine (§8–§9), never inferred from the version string. The
version bump is instead **validated against** the computed compatibility
(§10): a BREAKING diff must arrive on a MAJOR bump; a NON_BREAKING diff must
arrive on at least a MINOR bump; a METADATA_ONLY diff may arrive on a
PATCH bump. Reject registration otherwise (`VERSION_BUMP_MISMATCH`) — this
is the concrete enforcement of "Breaking changes must require a MAJOR
version bump."

---

## 3. Data model

All new tables live in the `catalog` schema, follow the existing migration
numbering (`013_*.sql` onward — check the highest existing number in
`data-product-catalog-service/migrations/` before assigning numbers), and
follow existing conventions exactly: `VARCHAR(64)` ids with the existing
prefix pattern from `common/ids/id-generator.ts` / `config/constants.ts`
`ID_PREFIXES`, `TIMESTAMPTZ NOT NULL DEFAULT now()` for `created_at`, no
soft-delete columns, append-only where the entity is an event.

**§6.** Extend `catalog.data_product_versions` (migration
`013_version_lifecycle_metadata.sql`):

```sql
ALTER TABLE catalog.data_product_versions
  ADD COLUMN compatibility_type   VARCHAR(16)  NOT NULL DEFAULT 'NON_BREAKING'
      CHECK (compatibility_type IN ('METADATA_ONLY', 'NON_BREAKING', 'BREAKING')),
  ADD COLUMN predecessor_version  VARCHAR(32),   -- nullable, the version this one was diffed against
  ADD COLUMN successor_version    VARCHAR(32),   -- nullable, set when a later version supersedes this one
  ADD COLUMN grace_period_end     TIMESTAMPTZ,   -- set on deprecateVersion(); after this, retirement may proceed
  ADD COLUMN migration_required   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN activated_at         TIMESTAMPTZ,   -- distinct from effective_from: effective_from is business-facing, activated_at is the literal transition timestamp
  -- Phase 11 governance hooks — columns only, never enforced or read by Phase 10 logic.
  ADD COLUMN data_classification  VARCHAR(32),   -- reuses catalog.CLASSIFICATIONS vocabulary, nullable
  ADD COLUMN retention_policy_ref VARCHAR(128),
  ADD COLUMN contains_pii         BOOLEAN,
  ADD COLUMN compliance_tags      JSONB        NOT NULL DEFAULT '[]'::jsonb;
```

Note `breaking_change BOOLEAN` already exists on this table (Phase 5) and
becomes redundant with `compatibility_type`. Keep both: `breaking_change =
(compatibility_type = 'BREAKING')`, written together, never independently —
existing Phase 5 code and tests read `breaking_change`; do not force a
rename that touches unrelated call sites for no behavioral gain.

**§7.** `catalog.version_compatibility_results` (migration `014`) — the
persisted structured diff (one row per compatibility evaluation, not just
per version, because re-registration attempts and dry-run evaluations
should also be recorded):

```sql
CREATE TABLE catalog.version_compatibility_results (
    compatibility_result_id  VARCHAR(64)  PRIMARY KEY,
    data_product_id           VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    from_version               VARCHAR(32),   -- nullable: null means "first version of the product"
    to_version                  VARCHAR(32)  NOT NULL,
    compatibility_level           VARCHAR(16)  NOT NULL
        CHECK (compatibility_level IN ('METADATA_ONLY', 'NON_BREAKING', 'BREAKING')),
    changes                         JSONB        NOT NULL DEFAULT '[]'::jsonb,   -- [{type, field, ...}]
    evaluated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**§8.** `catalog.version_dependencies` (migration `015`):

```sql
CREATE TABLE catalog.version_dependencies (
    version_dependency_id   VARCHAR(64)  PRIMARY KEY,
    dependent_data_product_id VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    dependent_version          VARCHAR(32)  NOT NULL,
    depends_on_data_product_id   VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    min_version                    VARCHAR(32)  NOT NULL,  -- inclusive
    max_version                      VARCHAR(32),           -- exclusive, nullable = unbounded
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT version_dependencies_unique UNIQUE
        (dependent_data_product_id, dependent_version, depends_on_data_product_id)
);
```

Example row for "Event Revenue Summary v2 depends on Event Performance >=
1.2 < 2.0": `depends_on_data_product_id='event-performance', min_version=
'1.2.0', max_version='2.0.0'`. `max_version` is exclusive by convention —
document this once in the module, do not re-derive it per call site.

**§9.** `catalog.migration_plans` and `catalog.migration_subscriptions`
(migration `016`):

```sql
CREATE TABLE catalog.migration_plans (
    migration_id       VARCHAR(64)  PRIMARY KEY,
    data_product_id      VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    from_version           VARCHAR(32)  NOT NULL,
    to_version                VARCHAR(32)  NOT NULL,
    compatibility               VARCHAR(16)  NOT NULL CHECK (compatibility IN ('METADATA_ONLY','NON_BREAKING','BREAKING')),
    status                        VARCHAR(16)  NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED')),
    start_at                        TIMESTAMPTZ,
    deadline                          TIMESTAMPTZ,
    reason                              TEXT,
    created_by                           VARCHAR(255),
    created_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE catalog.migration_subscriptions (
    migration_subscription_id  VARCHAR(64)  PRIMARY KEY,
    migration_id                 VARCHAR(64)  NOT NULL REFERENCES catalog.migration_plans (migration_id),
    subscription_id                VARCHAR(64)  NOT NULL,  -- opaque FK into subscription-service; no cross-DB FK
    organization_id                  VARCHAR(64)  NOT NULL,
    tenant_id                          VARCHAR(64)  NOT NULL,
    status                                VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'MIGRATED', 'FAILED', 'SKIPPED')),
    migrated_at                            TIMESTAMPTZ,
    CONSTRAINT migration_subscriptions_unique UNIQUE (migration_id, subscription_id)
);
```

Catalog never queries `subscription-service`'s database directly (same
discipline `subscription.repository.ts` already documents for other
siblings) — `subscription_id`, `organization_id`, `tenant_id` here are a
denormalized snapshot taken at plan-creation time via HTTP, not a live join.

**§10.** `catalog.version_approvals` (migration `017`) — a lightweight
record, not a workflow engine (explicitly out of scope, §0 non-goals):

```sql
CREATE TABLE catalog.version_approvals (
    approval_id          VARCHAR(64)  PRIMARY KEY,
    data_product_id        VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    version                   VARCHAR(32)  NOT NULL,
    compatibility_level        VARCHAR(16)  NOT NULL,
    required                     BOOLEAN     NOT NULL,  -- true only for BREAKING by default (see §22)
    approved_by                    VARCHAR(255) NOT NULL,
    approved_reason                  TEXT,
    approved_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

One row per approval action. A version with a required approval cannot
leave `DRAFT` for `BETA`/`ACTIVE` until a matching row exists — see §22.

**§11.** `catalog.version_beta_opt_ins` (migration `018`):

```sql
CREATE TABLE catalog.version_beta_opt_ins (
    beta_opt_in_id        VARCHAR(64)  PRIMARY KEY,
    data_product_version_id VARCHAR(64)  NOT NULL REFERENCES catalog.data_product_versions (data_product_version_id),
    organization_id           VARCHAR(64)  NOT NULL,
    tenant_id                   VARCHAR(64)  NOT NULL,
    opted_in_by                   VARCHAR(255) NOT NULL,
    opted_in_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT version_beta_opt_ins_unique UNIQUE (data_product_version_id, organization_id, tenant_id)
);
```

**§12.** Extend `catalog.registration_events` `event_type` check constraint
(migration `019_registration_events_lifecycle_types.sql` — `ALTER TABLE ...
DROP CONSTRAINT ... ADD CONSTRAINT ...`, since Postgres has no `ALTER
TYPE ... ADD VALUE` for a plain `VARCHAR CHECK`) and the corresponding
`REGISTRATION_EVENT_TYPES` array in `config/constants.ts`, adding:

```
COMPATIBILITY_EVALUATED
VERSION_APPROVED
VERSION_BETA_OPT_IN_GRANTED
MIGRATION_CREATED
MIGRATION_STATUS_CHANGED
SUBSCRIPTION_MIGRATED
VERSION_RETIREMENT_BLOCKED
VERSION_ROLLBACK
```

Keep the existing `VERSION_CREATED/VERSION_ACTIVATED/VERSION_DEPRECATED/
VERSION_RETIRED` — every lifecycle transition still emits exactly one of
these, as today; the new types cover the *new* actions Phase 10 adds.

---

## 4. Compatibility engine

**§13.** Extend `modules/compatibility/compatibility.service.ts` (moved
from `registration/compatibility.ts`, §2). The existing `assessCompatibility`
function already compares field-level schema (name, type, nullability,
grain-key, customer-visibility) between the previous and next version's
customer-visible fields — this is correct and stays as the core schema-diff
step. Add, as additional comparison passes feeding the same `changes[]`
array and the same breaking/non-breaking/metadata-only rollup:

- **Grain/key diff**: compare the *set* of grain-key fields and business-key
  fields between versions (not just per-field flags, which the existing
  code already does per-field — add a set-level check: if the grain
  definition's field composition changed at all, that's `BREAKING`
  regardless of individual field diffs, since grain is the contract's
  identity).
- **Quality contract diff**: compare `findQualityPolicy` rows (existing
  `modules/quality/quality.repository.ts`) between versions — a *tightened*
  quality rule (e.g. a new `NOT_NULL` check on a previously nullable field)
  is `NON_BREAKING` for the producer but should be flagged for
  visibility (`changes: [{type: "QUALITY_RULE_ADDED", ...}]`), never
  blocking.
- **SLA diff**: compare `findSlaPolicy` rows — an *improved* SLA (tighter
  freshness/completeness target) is `NON_BREAKING`; a *loosened* SLA that
  a consumer contract explicitly declared reliance on is `BREAKING`. Since
  Phase 5/9 don't currently model per-consumer SLA reliance declarations,
  treat any SLA loosening as `NON_BREAKING` but always emit a `changes[]`
  entry (`SLA_LOOSENED`) so it's visible in the diff and reviewable during
  approval (§22) — do not silently drop it.
- **Delivery-method diff**: compare `modules/delivery/delivery.repository.ts`
  rows — removing a previously-published delivery method or file format is
  `BREAKING`; adding one is `NON_BREAKING`.
- **API contract diff**: compare the `getApiContract` shape (`modules/
  versions/version.service.ts`, backing `/internal/v1/versions/api-
  contract`) — removing a filter/sort field or a published field from the
  API contract is `BREAKING`; adding one is `NON_BREAKING`; tightening
  `maxPageSize`/`freshnessMinutes` is `BREAKING` if it invalidates
  documented consumer expectations, loosening is `NON_BREAKING`.

**§14.** Every compatibility evaluation call — at registration time (already
happens today via `registration.service.ts`) and at any explicit
`POST /internal/v1/data-products/:productId/versions/:version/evaluate-
compatibility` dry-run call (§23) — persists one row to
`version_compatibility_results` (§7) and emits a `COMPATIBILITY_EVALUATED`
registration event. This is what makes compatibility decisions
"explainable" per the requirement: the diff is queryable after the fact,
not just log output.

**§15.** The compatibility result's `changes[]` shape, matching the
required example exactly:

```json
{
  "compatibility": "BREAKING",
  "changes": [
    { "type": "FIELD_REMOVED", "field": "venue_id" }
  ]
}
```

Define a closed set of `type` values used across all diff passes:
`FIELD_ADDED, FIELD_REMOVED, FIELD_TYPE_CHANGED, FIELD_MADE_REQUIRED,
FIELD_VISIBILITY_CHANGED, GRAIN_CHANGED, KEY_CHANGED, QUALITY_RULE_ADDED,
QUALITY_RULE_REMOVED, SLA_IMPROVED, SLA_LOOSENED, DELIVERY_METHOD_REMOVED,
DELIVERY_METHOD_ADDED, API_FILTER_REMOVED, API_FILTER_ADDED,
API_FIELD_REMOVED, DOCUMENTATION_CHANGED`. Each entry carries `field` (or
`method`/`filter` as appropriate) plus a short human-readable `detail`
string — keep it structured enough to render in the customer-safe/internal
APIs (§23–§24) without re-parsing free text.

---

## 5. Version lifecycle state machine

**§16.** `VERSION_LIFECYCLE_STATUSES` in `config/constants.ts` already
equals `["DRAFT", "BETA", "ACTIVE", "DEPRECATED", "RETIRED"]` — no change
needed there. Add an explicit transition table in `modules/lifecycle/
transition-rules.ts` (new file, mirroring `subscription-service/src/domain/
transition-rules.ts`'s pattern exactly — same shape, same
`canTransition`/`assertTransition` functions, so both services read
identically to anyone auditing them):

```ts
const ALLOWED_TRANSITIONS: Record<VersionLifecycleStatus, readonly VersionLifecycleStatus[]> = {
  DRAFT:      ["BETA", "ACTIVE"],
  BETA:       ["ACTIVE", "RETIRED"],   // a BETA that never ships can be retired directly
  ACTIVE:     ["DEPRECATED"],
  DEPRECATED: ["RETIRED", "ACTIVE"],   // ACTIVE only via explicit rollback (§21), never a normal transition
  RETIRED:    [],                       // terminal
};
```

`activateVersion` currently rejects `RETIRED -> ACTIVE` with a bespoke
check (`VERSION_NOT_ACTIVATABLE`) — replace that ad hoc check with
`assertTransition`, and route `deprecateVersion`/`retireVersion` through it
too, exactly as `subscription-service`'s services already route every call
through `assertTransition` rather than validating inline (this repo already
has that convention once; Phase 10 should match it, not invent a second
style).

**§17.** `DEPRECATED -> ACTIVE` (rollback) is reachable only through the
dedicated `rollback` action (§21), never through the generic `activate`
action — `activateVersion`'s current DRAFT/BETA-only precondition (contract
+ schema + SLA + quality policy present) stays required for the normal
DRAFT/BETA→ACTIVE path; rollback has its own, narrower precondition (§21).
Keep these as two separate exported functions (`activateVersion`,
`rollbackVersion`) rather than one function with a mode flag — they have
different preconditions, different audit event types, and conflating them
is exactly the kind of implicit branching this codebase avoids elsewhere
(e.g. `subscription-service`'s `entitlement.service.ts` vs
`entitlement-revocation.service.ts` are separate files for the same
reason).

**§18.** Consumption gating per status (enforced in version-resolution,
§25–§29, not re-checked ad hoc elsewhere):

| Status | New subscriptions | Existing subscriptions | Scheduled delivery | New API reads |
|---|---|---|---|---|
| DRAFT | never | never | never | never |
| BETA | only opted-in tenants (§11) | only opted-in tenants | only opted-in tenants | only opted-in tenants, and only via explicit-version access (§30) |
| ACTIVE | yes | yes | yes | yes |
| DEPRECATED | no (floating policies skip it; EXACT still allowed with a warning, §26) | yes, until `grace_period_end` | yes, until `grace_period_end` | yes |
| RETIRED | never | never (delivery fails closed) | never | never |

---

## 6. Activation, deprecation, retirement rules

**§19.** `activateVersion` (extend in place): before the existing
contract/schema/SLA/quality-policy checks, add the semver-vs-compatibility
validation from §5. On success, in addition to what it already does
(supersede the prior canonical ACTIVE version to DEPRECATED, set
`current_active_version`, record `VERSION_ACTIVATED`), also:

- Set `activated_at = now()` and `predecessor_version` = the version being
  superseded (if any) on the newly-ACTIVE row; set `successor_version` on
  the superseded row to point forward.
- If the version being superseded has a non-null `grace_period_end`
  already set from an earlier direct `deprecateVersion` call, leave it —
  don't overwrite an explicit grace period with the default.
- If it does **not** have one yet (the common case: a version goes straight
  from ACTIVE to DEPRECATED *via being superseded*, not via an explicit
  `deprecateVersion` call), set `grace_period_end = now() + <configurable
  default>` (env var `DEFAULT_GRACE_PERIOD_DAYS`, default `90`) — every
  DEPRECATED version has a grace period from the moment it stops being
  canonical, whether it got there by explicit deprecation or by
  supersession. This closes a real gap: today `activateVersion` deprecates
  the old version with `deprecatedAt` but no grace period at all.

**§20.** `deprecateVersion` (extend in place): accept
`gracePeriodDays?: number` in the request body (default from the same env
var as §19); set `grace_period_end` accordingly. Keep existing behavior
(only clears `current_active_version` if the deprecated version was the
canonical ACTIVE one). Add: if `replacementVersion` is given, validate it
exists and set `successor_version` on this row.

**§21.** `retireVersion` (extend in place) — this is where the real new
work is. Replace the current single check ("is this the canonical ACTIVE
version, and was `force` passed") with the full retirement safety chain
from the requirements, implemented as an ordered list of blocker checks in
a new `modules/lifecycle/retirement-guard.ts`:

```ts
export interface RetirementBlocker {
  type: "ACTIVE_SUBSCRIPTIONS" | "SCHEDULED_JOBS" | "ACTIVE_PUBLICATIONS"
      | "API_CONSUMERS" | "DEPENDENT_PRODUCTS" | "GRACE_PERIOD_NOT_COMPLETE";
  detail: string;
  count?: number;
}
export async function checkRetirementBlockers(dataProductId: string, version: string): Promise<RetirementBlocker[]>;
```

Each check:

1. **Active subscriptions** — call `subscription-service`'s
   `GET /internal/v1/subscriptions/delivery-candidates?data_product_id=&
   status=ACTIVE` (existing endpoint, §31) and filter client-side to
   subscriptions whose policy currently resolves to this exact version
   (via the shared resolver, §25). Non-empty → blocker.
2. **Scheduled jobs** — call `scheduling-service`'s existing internal
   executions/schedule listing (check
   `scheduling-service/src/api/internal/scheduler.routes.ts` for the exact
   existing path before adding a new one) filtered to this
   `data_product_id`/`version`; any `PENDING`/`SCHEDULED` execution →
   blocker.
3. **Active publications** — call `data-publication-service`'s
   `GET /internal/v1/publications?...` (used by Phase 9's adapter per the
   Phase 9 report) filtered to this product/version with a non-terminal
   status → blocker.
4. **API consumers** — `data-product-api-service` has no internal API and
   emits no events today (confirmed in the Phase 9 report: "No internal
   API and no events emitted today"). Do not invent one for this alone.
   Instead, treat "has an ACTIVE or DEPRECATED-in-grace subscription with
   an API delivery method" as the proxy for "has API consumers" — this
   folds into check 1, so implement check 1 to also flag `hasApiConsumers:
   boolean` on the blocker detail rather than adding a distinct check that
   nothing backs today.
5. **Dependent products** — query `version_dependencies` (§8) for rows
   where `depends_on_data_product_id = dataProductId` and this version
   falls within `[min_version, max_version)` of a dependent product's
   version that is not itself RETIRED. Non-empty → blocker.
6. **Grace period** — if `grace_period_end` is set and `now() <
   grace_period_end` → blocker, unless the version was never DEPRECATED
   (e.g. retiring a BETA directly has no grace period to wait out).

**§22.** If any blocker exists and `force` is not `true`: reject with
`VERSION_NOT_RETIRABLE`, body includes the full blocker list, and record a
`VERSION_RETIREMENT_BLOCKED` registration event (with the blocker list in
`event_data`) — blocked attempts are auditable, not just rejected silently.
This satisfies "Demonstrate: retirement blocked" as a real, inspectable
event, not just an HTTP 409.

If `force: true` is passed: **require** a non-empty `reason` string in the
request body (`VALIDATION_ERROR` if missing) and require the caller's role
to be `PLATFORM_ADMIN` (not `PRODUCT_ADMIN` — retiring over active
blockers is a platform-level override, one level above normal product
administration; `requireInternalAuth("PLATFORM_ADMIN")` on this route,
matching the precedent in `subscription-service`'s `/suspend` route). Record
`VERSION_RETIRED` with `event_data: { force: true, reason, overriddenBlockers:
[...] }`.

**§23.** Add `POST /internal/v1/data-products/:productId/versions/:version/
evaluate-compatibility` — a dry-run that runs the compatibility engine
against a candidate contract *without* creating a version row, for use
before registration. This is the "compatibility approval workflow" surface:
an operator (or CI) calls this first, inspects the diff, then decides
whether to proceed with actual registration.

**§24.** `POST /internal/v1/data-products/:productId/versions/:version/
approve` records a `version_approvals` row (§10) and a `VERSION_APPROVED`
event. A version whose latest compatibility evaluation is `BREAKING`
**must** have a matching approval row before `activateVersion` or the
`BETA`-targeting call in §19 will let it leave `DRAFT`. This is the
"breaking-change approval" requirement, kept intentionally minimal (no
approval chains, no roles beyond `PRODUCT_ADMIN`/`PLATFORM_ADMIN` — a full
approval workflow engine is explicitly out of scope, §0).

---

## 7. Version dependency model

**§25.** `modules/dependencies/dependency.repository.ts` — CRUD over
`version_dependencies` (§8). `modules/dependencies/dependency.service.ts`
exposes:

```ts
export async function declareDependency(input: {
  dependentDataProductId: string; dependentVersion: string;
  dependsOnDataProductId: string; minVersion: string; maxVersion?: string;
}): Promise<void>;

export async function listDependents(dataProductId: string, version: string): Promise<DependencyRow[]>;
export async function listDependencies(dataProductId: string, version: string): Promise<DependencyRow[]>;
```

`declareDependency` validates `dependsOnDataProductId` exists and that
`minVersion` (and `maxVersion` if given) parse as semver — it does **not**
require the referenced version to currently exist or be ACTIVE (a
dependency can be declared against a range before every version in it has
been created).

---

## 8. Impact analysis

**§26.** `modules/impact-analysis/impact-analysis.service.ts`:

```ts
export interface ImpactSummary {
  dataProductId: string;
  fromVersion: string;
  toVersion: string;
  totalSubscriptions: number;
  byResolutionGroup: {
    resolvesToFrom: number;       // policy currently resolves to fromVersion
    resolvesToTo: number;         // policy already resolves to toVersion
    pinnedToFrom: number;         // EXACT policy == fromVersion — never auto-moves
    betaOptedIn: number;          // resolves via explicit BETA opt-in
  };
  requiresExplicitAction: number; // pinned/EXACT subscriptions on a version being retired, with no migration plan covering them
}
export async function computeImpact(dataProductId: string, fromVersion: string, toVersion: string): Promise<ImpactSummary>;
```

Implementation: fetch all subscriptions for `dataProductId` from
`subscription-service`'s `delivery-candidates` endpoint (§31), resolve each
one's policy via the shared resolver (§27) against the *current* catalog
state, and bucket. This reproduces the required example exactly:

```
Event Performance 1.2 → 2.0
Subscribers: 42 total
28 using: 1.x compatible
10 pinned: 1.2.0
4 beta opted-in: 2.0.0
Migration status: 14 require explicit action
```

`GET /internal/v1/data-products/:productId/versions/:version/impact`
(query param `?against=<toVersion>`, defaulting to the current ACTIVE
version if omitted) returns this shape.

---

## 9. Version resolution — the one shared resolver

**§27.** This is the most important correctness fix in Phase 10. Today,
`subscription-service/src/infrastructure/catalog-client/catalog-client.ts`'s
`resolveVersionPolicy` *re-implements* ranking logic (fetch all versions,
filter to `ACTIVE`, sort, pick best) rather than asking Catalog to do it.
That duplicates authority Catalog should own, and it has a latent bug this
phase must fix: because it filters to `lifecycleStatus === "ACTIVE"` only,
a `COMPATIBLE_MAJOR`-type (renamed `PINNED_MAJOR`/`COMPATIBLE_MINOR`, §28)
subscriber pinned to major version 1 would get `VERSION_POLICY_NOT_
RESOLVABLE` the moment major version 2 activates and every 1.x version
becomes DEPRECATED — even though those subscribers explicitly asked to
stay on major 1. That directly contradicts "Do not silently move a
customer across breaking major versions" (a resolution *failure* isn't a
silent move, but it's still wrong: the subscriber's own pinned range still
has a perfectly good DEPRECATED-but-serving version available).

Fix: move resolution into Catalog, as the authoritative implementation,
and make Subscription's function a thin HTTP wrapper.

**§28.** New Catalog module `modules/version-resolution/resolver.ts`:

```ts
export type VersionPolicyType = "EXACT" | "COMPATIBLE_PATCH" | "COMPATIBLE_MINOR" | "PINNED_MAJOR" | "LATEST_ACTIVE";
export interface VersionPolicy { type: VersionPolicyType; value: string | null; }
export type ResolutionIntent = "SUBSCRIBE" | "DELIVER"; // see §29 for the distinction

export interface ResolvedVersion {
  version: string;
  lifecycleStatus: VersionLifecycleStatus;
  fellBackToDeprecated: boolean; // true when the pick came from the DEPRECATED fallback, not ACTIVE
}

export async function resolveVersion(
  dataProductId: string,
  policy: VersionPolicy,
  intent: ResolutionIntent,
  optedInTenant?: { organizationId: string; tenantId: string },
): Promise<ResolvedVersion>;
```

Policy semantics, reconciling the five required patterns precisely:

- **EXACT** (`value` = a full version) — resolves to that exact version
  regardless of lifecycle status, **except** `DRAFT` (never resolvable) and
  `RETIRED` (never resolvable — resolution fails closed, `VERSION_
  RETIRED_UNRESOLVABLE`). Resolving EXACT to a `BETA` version additionally
  requires `optedInTenant` to have a `version_beta_opt_ins` row (§11) for
  that exact version — otherwise `VERSION_REQUIRES_BETA_OPT_IN`.
- **COMPATIBLE_PATCH** (`value` = `MAJOR.MINOR`, e.g. `"1.2"`) — candidates
  are every version whose major+minor equals `value` (via
  `isSameMajorMinor`). Never BETA, never DRAFT, never RETIRED.
- **COMPATIBLE_MINOR** (`value` = `MAJOR`, e.g. `"1"`) — candidates are
  every version whose major equals `value` (via `isSameMajor`). This is
  the renamed, corrected form of today's `COMPATIBLE_MAJOR` behavior in
  `version-policy.ts` — same "1.x" semantics the user-facing spec names
  `COMPATIBLE_MINOR`, floats freely across minor **and** patch within the
  major. Never BETA, never DRAFT, never RETIRED.
- **PINNED_MAJOR** (`value` = `MAJOR`) — same candidate set as
  `COMPATIBLE_MINOR`, but resolution additionally respects a
  `minorUpgradeBehavior` flag carried on the subscription (§32):
  `AUTO_UPGRADE_MINOR` (default — identical to `COMPATIBLE_MINOR`),
  `PIN_CURRENT` (once resolved once, keep returning that same version on
  every subsequent call until an explicit re-resolution is requested —
  implemented by the *caller* passing the subscription's last-resolved
  version back in as a preferred-candidate hint; the resolver itself stays
  stateless), `MANUAL_APPROVAL` (same as `PIN_CURRENT` until a
  `version_approvals` row exists for the new candidate, then it becomes
  the pick). This is the distinction between `COMPATIBLE_MINOR` and
  `PINNED_MAJOR` — the former always auto-adopts, the latter is
  auto-adopt-by-default but overridable per subscription.
- **LATEST_ACTIVE** (`value` = `null`) — candidates are every ACTIVE
  version of the product, no major restriction. Never BETA/DRAFT/RETIRED,
  and (per requirement) never DEPRECATED either — this is the one policy
  type where "latest" must mean the single canonical ACTIVE version, full
  stop.

For `COMPATIBLE_PATCH`/`COMPATIBLE_MINOR`/`PINNED_MAJOR`, candidate
filtering by intent (§29) determines whether DEPRECATED is included; among
whatever the eligible set is, prefer `ACTIVE` over `DEPRECATED`, and within
the same status pick the highest semver (`compareSemver`).

**§29.** `intent` resolves the ACTIVE-vs-DEPRECATED ambiguity precisely:

- `"SUBSCRIBE"` — used when creating or updating a subscription's policy.
  Candidate set for floating policies is `ACTIVE` only. This is what
  makes "New subscriptions should normally not select a DEPRECATED
  version" true by construction, without needing a separate rule.
- `"DELIVER"` — used by the Scheduler (via Subscription's delivery-context
  call, §31) at actual delivery time. Candidate set for floating policies
  is `ACTIVE ∪ DEPRECATED` (never BETA/DRAFT/RETIRED) — this is what lets
  an existing subscriber ride out a DEPRECATED version's grace period
  instead of hard-failing the moment their pinned major stops being
  canonical.

**§30.** Expose this as `POST /internal/v1/data-products/:productId/
resolve-version` (body: `{ policy: {type, value}, intent, organizationId?,
tenantId? }`, `organizationId`/`tenantId` required only when a BETA
candidate is in play). `subscription-service/src/domain/version-policy.ts`
keeps `parseVersionPolicy`/`formatVersionPolicy` (parsing user input into
the `{type, value}` shape is genuinely Subscription's job — it owns the
subscription's stored preference) but its `catalog-client.ts`'s
`resolveVersionPolicy` becomes:

```ts
export async function resolveVersionPolicy(
  dataProductId: string, policy: VersionPolicy, intent: "SUBSCRIBE" | "DELIVER",
  tenant?: { organizationId: string; tenantId: string },
): Promise<ResolvedVersion> {
  return catalogFetch<ResolvedVersion>(`/internal/v1/data-products/${dataProductId}/resolve-version`, {
    internal: true, method: "POST",
    body: { policy, intent, organizationId: tenant?.organizationId, tenantId: tenant?.tenantId },
  });
}
```

Delete the local filter/sort/`majorOf` logic entirely from
`catalog-client.ts` — it is now dead code once Catalog owns resolution.
`scheduling-service` needs **no changes** for this — it already only talks
to Subscription's `delivery-context`/`resolve` endpoints (§31) and never
resolves a version itself, so centralizing resolution inside Catalog is
invisible to it. This is what "the scheduler must call a shared version
resolver rather than implement its own version logic" already looks like
once Subscription itself stops implementing one.

**§31.** Subscription-service call sites that must now pass an `intent`:
`getDeliveryContext`/`getDeliveryContextForScope`
(`application/services/subscription.service.ts`) use `"DELIVER"` — these
back the Scheduler's per-cycle delivery-context fetch. The subscription
create/update handlers (wherever a new `version_policy` is validated) use
`"SUBSCRIBE"`. Use `subscription-service`'s existing internal
`delivery-candidates` endpoint unchanged for impact analysis (§26) and
retirement blocker checks (§21) — it already supports `data_product_id`
filtering.

**§32.** `subscription-service`'s `subscriptions` table gains one column
(new migration in `subscription-service/migrations/`):

```sql
ALTER TABLE subscription.subscriptions
  ADD COLUMN minor_upgrade_behavior VARCHAR(16) NOT NULL DEFAULT 'AUTO_UPGRADE_MINOR'
    CHECK (minor_upgrade_behavior IN ('AUTO_UPGRADE_MINOR', 'PIN_CURRENT', 'MANUAL_APPROVAL')),
  ADD COLUMN last_resolved_version   VARCHAR(32);
```

`last_resolved_version` is updated after every successful `"DELIVER"`
resolution — it's the hint `PIN_CURRENT`/`MANUAL_APPROVAL` need (§28) and
also directly answers "what version is this subscription actually on
right now" for support/debugging without re-resolving.

---

## 10. Rollback

**§33.** `modules/lifecycle/lifecycle.service.ts` gains
`rollbackVersion(dataProductId, targetVersion, actor, reason)`:

- Precondition: `targetVersion` must currently be `DEPRECATED` and must be
  the `predecessor_version` of the current canonical ACTIVE version (i.e.
  rollback only ever un-supersedes the *immediately previous* version —
  skipping back further requires a sequence of rollbacks, not a jump, so
  the audit trail stays a straight line).
- Effect: current ACTIVE version → `DEPRECATED` (with a fresh
  `grace_period_end`, §19's default), `targetVersion` → `ACTIVE`
  (`activated_at = now()`, `current_active_version` repointed). No row is
  deleted, no `created_at`/history is rewritten — this is "a new lifecycle
  action and active-version pointer change," exactly as required.
- Emits `VERSION_ROLLBACK` (not `VERSION_ACTIVATED`) with `event_data: {
  rolledBackFrom: <version>, reason }`.
- `POST /internal/v1/data-products/:productId/versions/:version/rollback`,
  `requireInternalAuth("PLATFORM_ADMIN")` (an emergency action, same
  authorization bar as the retirement force-override, §22).

---

## 11. Internal, customer-safe, and admin APIs

**§34.** New/extended internal endpoints (all `requireInternalAuth`, roles
as noted; all in `modules/lifecycle/lifecycle.routes.ts` and `modules/
migrations/migration-plan.routes.ts` unless noted otherwise):

```
POST /internal/v1/data-products/:productId/versions/:version/activate         (extend existing, PRODUCT_ADMIN)
POST /internal/v1/data-products/:productId/versions/:version/deprecate        (extend existing, PRODUCT_ADMIN)
POST /internal/v1/data-products/:productId/versions/:version/retire           (extend existing, PRODUCT_ADMIN; PLATFORM_ADMIN for force)
POST /internal/v1/data-products/:productId/versions/:version/rollback         (new, PLATFORM_ADMIN)
POST /internal/v1/data-products/:productId/versions/:version/evaluate-compatibility  (new, CONTRACT_REGISTRAR)
POST /internal/v1/data-products/:productId/versions/:version/approve          (new, PRODUCT_ADMIN)
GET  /internal/v1/data-products/:productId/versions/:version/impact           (new, CATALOG_READER; ?against=)
POST /internal/v1/data-products/:productId/resolve-version                    (new, CATALOG_READER — called by every sibling service)
POST /internal/v1/data-products/:productId/versions/:version/beta-opt-in      (new, PRODUCT_ADMIN; body: organizationId, tenantId)
POST /internal/v1/data-products/:productId/dependencies                       (new, PRODUCT_ADMIN)
GET  /internal/v1/data-products/:productId/versions/:version/dependents       (new, CATALOG_READER)
POST /internal/v1/data-products/:productId/migrations                         (new, PRODUCT_ADMIN)
GET  /internal/v1/data-products/:productId/migrations/:migrationId            (new, CATALOG_READER)
POST /internal/v1/data-products/:productId/migrations/:migrationId/execute    (new, PRODUCT_ADMIN — moves PLANNED/IN_PROGRESS subscriptions, §21 style guarded)
GET  /internal/v1/data-products/:productId/versions/:version/lifecycle-events (new, CATALOG_READER — reads registration_events filtered/typed)
```

**§35.** Migration plan creation (`POST .../migrations`): body `{toVersion,
startAt?, deadline?, reason?}`; server computes `fromVersion` (current
canonical ACTIVE), `compatibility` (from the latest `version_
compatibility_results` row for that pair), and `affected_subscriptions`
(from `computeImpact`, §26) at creation time — snapshotted into
`migration_subscriptions` rows with `status='PENDING'`, one per subscription
in `resolvesToFrom` ∪ `pinnedToFrom` (the subscriptions that would actually
need to move). Emits `MIGRATION_CREATED`.

`POST .../migrations/:id/execute` — for a `NON_BREAKING` migration, updates
each `PENDING` `migration_subscriptions` row's linked subscription's
`version_policy`/`last_resolved_version` via a call to `subscription-
service`'s existing subscription-update path (do not write Subscription's
table directly — cross-service writes always go through the owning
service's API, matching every other cross-service interaction in this
repo), marks it `MIGRATED`, emits `SUBSCRIPTION_MIGRATED` per subscription
and `MIGRATION_STATUS_CHANGED` (→ `COMPLETED`) once all rows are terminal.
For a `BREAKING` migration, `execute` **must** reject
(`MIGRATION_REQUIRES_MANUAL_ACTION`) unless each individual subscription
has already been moved by its owner (EXACT-repin to the new version) —
this is the concrete enforcement of "Do not automatically change customer
subscriptions during breaking major migrations without policy/approval."
A `BREAKING` migration plan exists for tracking/reporting (§39 metrics),
never for auto-execution.

**§36.** Customer-safe API — extend the existing `GET /v1/data-products/
:productId/versions` and `GET /v1/data-products/:productId/versions/
:version` (`modules/versions/version.routes.ts`, already customer-safe per
its existing "spec §27/§55" comment) to add `deprecationDeadline`
(=`grace_period_end`, only present when `DEPRECATED`), `compatibility`
(=`compatibility_type`), `releasedAt` (=`activated_at`), matching the
required example exactly:

```json
{
  "productId": "event-performance",
  "versions": [
    { "version": "1.3.0", "status": "ACTIVE", "releasedAt": "...", "compatibility": "NON_BREAKING" },
    { "version": "1.2.0", "status": "DEPRECATED", "deprecationDeadline": "..." }
  ]
}
```

`DRAFT` versions are never included in this list (the existing
`getCustomerVersionDetail`/`listCustomerVersions` already filter — verify
and keep). `BETA` versions are included only when the request carries an
authenticated tenant context that has an opt-in row (§11) — since this
route currently takes no auth at all (per its own comment, "no internal
registration actors"), and Catalog doesn't own tenant authentication,
BETA-version visibility on this route requires the caller to pass a
tenant-scoped internal call instead: keep the public route BETA-blind
(never lists BETA at all — simplest, safest default) and let
`subscription-service`'s own customer-facing subscription APIs be where a
tenant discovers BETA availability (it already knows the caller's tenant
identity). Do not add tenant auth to Catalog's public routes for this —
that would duplicate `subscription-service`'s and `data-product-api-
service`'s existing customer-auth middleware for no benefit.

**§37.** Never expose in any `/v1/*` response: `approved_by`,
`created_by`, `actor_id`/`actor_type` from registration events, Git
paths/commit hashes (already excluded per the existing comment), or raw
`migration_subscriptions` rows (which contain other tenants' subscription
ids). Internal-only fields stay behind `requireInternalAuth`.

---

## 12. API Delivery — version routing

**§38.** `data-product-api-service` gets one new route family alongside its
existing `events.routes.ts` (check the exact current mount path — the spec
example is illustrative, match whatever resource name Phase 8 actually
used):

```
GET /v1/data-products/event-performance/events                       -- policy-resolved default (existing route, unchanged)
GET /v1/data-products/event-performance/versions/:version/events      -- NEW: explicit-version access
```

The explicit-version route calls Catalog's `resolve-version` with
`policy={type: "EXACT", value: version}` and `intent: "DELIVER"` (not
"SUBSCRIBE" — an existing subscriber reading an explicit deprecated
version mid-grace-period is a legitimate delivery, not a new subscription
attempt) to get lifecycle status + BETA opt-in enforcement for free,
**and** additionally checks that the authenticated tenant actually has an
ACTIVE-or-`DEPRECATED`-in-grace subscription to this product at all
(reuse Phase 8's existing entitlement check — do not bypass it just
because a version was named explicitly in the URL). RETIRED and DRAFT
always 404 regardless of entitlement. Keep the API platform version
(`/v1`) and the Data Product version (`:version` path segment)
syntactically and semantically separate, exactly as required — never
derive one from the other.

**§39.** `data-product-api-service` gains no new internal API/event
emission in this phase (per §21's note, it has none today and Phase 10
doesn't require adding one) — its version awareness is entirely in the
request-handling path above, using Catalog's `resolve-version` and its
existing entitlement check.

---

## 13. Publication Service integration

**§40.** No schema change needed — `data-publication-service`'s
`product_version: str` field on `PublicationTriggerRequest`/response
(`schemas.py`) already carries the resolved version end-to-end, and the
Phase 7 report already documents "Publication Service must never silently
substitute another version" as an existing invariant (confirmed by reading
`routes.py`: the scope lookup uses `product_version` verbatim, no
re-resolution inside Publication). Phase 10 only needs to verify — via a
new integration test (§44) — that a `resolvedProductVersion` coming out of
Scheduler's `"DELIVER"`-intent resolution round-trips through Publication
unchanged, including for a DEPRECATED-in-grace-period version. If
Publication currently rejects non-ACTIVE versions anywhere, that check must
be relaxed to accept DEPRECATED (never DRAFT/BETA-without-opt-in/RETIRED —
Publication should trust Scheduler's already-gated resolution rather than
re-implementing the gate, but a defensive check that the version isn't
RETIRED is reasonable defense-in-depth).

---

## 14. Observability integration

**§41.** `data-platform-observability-service` already correlates and
scopes by `(tenant, product, version)` per the Phase 9 report. Phase 10
adds no new ingestion mechanism — it adds new **metrics computed from
existing correlation data plus Catalog's lifecycle state**, in a new
`application/services/version-adoption.service.ts`:

- `subscribers_by_version` — pull from Catalog's impact-analysis endpoint
  (§26) per product, or maintain locally by polling `resolve-version`
  results already present in delivery-context enrichment (Phase 9's
  report notes it already calls `subscription-service`'s delivery-context
  for enrichment — extend that call site to also capture the resolved
  version if not already captured).
- `requests_by_version`, `publications_by_version`, `failures_by_version`,
  `SLA_pass_rate_by_version` — these already exist implicitly since Phase
  9's `operational_executions`/`sla_evaluations` are already scoped by
  version; add a `GROUP BY data_product_id, product_version` query path
  and expose it as `GET /internal/v1/operations/data-products/:id/
  versions/:version/health` (mirrors the existing per-product health
  route, scoped one level deeper).
- `adoption_percentage` = (subscribers resolved to a given version) /
  (total subscribers of the product) — computed from the same
  impact-analysis call, cached briefly (existing `catalog-sla-sync.
  service.ts` already established the append-and-supersede caching
  pattern for pulling Catalog data into Observability — reuse it, don't
  invent a second caching approach).
- `deprecated_version_usage` — count of executions/requests against
  DEPRECATED versions in the last N days, surfaced specifically to flag
  "consumers still riding a grace period."
- `migrations_remaining` — pulled directly from Catalog's migration plan
  (`migration_subscriptions WHERE status='PENDING'` count), exposed
  read-only via a thin passthrough, not recomputed in Observability.

---

## 15. Service-to-service auth

**§42.** No new auth mechanism. Every new internal endpoint uses the
existing `requireInternalAuth(role?)` middleware already present in every
service (`x-internal-api-key` + `x-actor-type/x-actor-id/x-actor-role`
headers, per the Phase 9 report's documented convention and the auth
middleware files already read above). New internal HTTP clients
(`subscription-service` → Catalog's `resolve-version`; Observability →
Catalog's `impact`/migrations reads) follow the exact pattern in
`subscription-service/src/infrastructure/catalog-client/catalog-client.ts`
(`x-actor-type: SERVICE`, `x-actor-id: <calling-service-name>`,
`x-actor-role` set to whatever role the target endpoint requires).

---

## 16. Idempotency and auditability

**§43.** Lifecycle transitions (`activate`/`deprecate`/`retire`/`rollback`)
are naturally idempotent by construction of `assertTransition` (§16): a
repeated `activate` call on an already-ACTIVE version rejects via the
transition table (`ACTIVE` has no `ACTIVE` in its allowed-targets list —
add an explicit early return with a clear "already in this state" message
rather than a generic transition error, matching how `subscription-
service`'s handlers treat a no-op transition as a friendly 200/409 rather
than a confusing state-machine error). Migration plan creation is not
idempotent by request body alone — accept an optional
`external_idempotency_key` on `POST .../migrations`, reusing the existing
`with-idempotency.ts` pattern from `subscription-service/src/
infrastructure/idempotency/` if Catalog doesn't already have an equivalent
(check first; if catalog has none, port the pattern rather than
reinventing it — same table shape, same wrapper function signature).

**§44.** Every lifecycle/compatibility/migration/dependency/approval/
retirement-block/rollback action records exactly one `registration_events`
row (§12's expanded type list), in the same transaction as the state
change it describes (`withTransaction`, matching the existing pattern in
`lifecycle.service.ts`). This is the entire audit trail — no separate
audit table, consistent with how this table already serves that role for
Phase 5's three original event types.

---

## 17. Testing

**§45.** Unit tests (`data-product-catalog-service/src/tests/unit/`):
semver parsing/comparison/bump-kind (extend existing `semver.test.ts`),
valid and invalid lifecycle transitions (`transition-rules.test.ts`, new —
mirror `subscription-service`'s `transition-rules.test.ts` structure
exactly), compatibility engine for each new diff pass (grain, quality,
SLA, delivery, API contract — extend `compatibility.test.ts`), the
resolver's five policy types × two intents × BETA-opt-in-present/absent
matrix (`resolver.test.ts`, new).

**§46.** Integration tests (`.../tests/integration/`): non-breaking minor
change end to end (register 1.3.0 with an added optional field →
`NON_BREAKING` persisted, activation succeeds, `predecessor_version`/
`successor_version` set correctly); breaking major change (register 2.0.0
removing a published field → `BREAKING`, activation blocked without
approval, `BETA` activation allowed); invalid breaking-as-minor attempt
(remove a field but bump only the minor → `VERSION_BUMP_MISMATCH`
rejected); metadata-only patch; exact-version subscription resolution;
`COMPATIBLE_PATCH`/`COMPATIBLE_MINOR`/`PINNED_MAJOR`/`LATEST_ACTIVE`
resolution against a fixture catalog matching the worked examples in this
document exactly (1.1.0 DEPRECATED / 1.2.0 ACTIVE / 1.3.0 ACTIVE / 2.0.0
BETA → `1.x` resolves to `1.3.0`); BETA opt-in required and enforced;
DEPRECATED-version delivery continues within grace period, fails after;
blocked retirement (each of the six blocker types individually, and
combined); successful retirement after blockers clear; dependency-blocked
retirement; migration plan creation with correct `affected_subscriptions`
snapshot; `AUTO_UPGRADE_MINOR` auto-adoption; `BREAKING` migration
`execute` rejection without per-subscription manual moves; rollback
(ACTIVE → DEPRECATED → rollback → ACTIVE again, history rows intact,
correct event type). Two-tenant isolation: two tenants' subscriptions to
the same product resolving independently, one tenant's BETA opt-in never
leaking visibility/access to the other.

**§47.** Cross-service tests: `subscription-service`'s existing contract
test (`tests/contract/catalog-client.test.ts`) must be extended to cover
the new `resolve-version` call shape — this is the one existing test file
most likely to break from the `catalog-client.ts` refactor in §30, fix it
alongside that change, not after. `scheduling-service`'s existing e2e
(`tests/e2e/vobis-demo.test.ts`) should be re-run unchanged (§30 states
Scheduler needs zero code changes) — if it breaks, that's a signal the
resolver refactor leaked a behavior change into `"DELIVER"` intent
resolution and must be fixed, not worked around in Scheduler. A new
Observability integration test verifies per-version metrics against a
fixture with two versions and mixed subscriber resolution.

**§48.** Run existing full suites for `data-product-catalog-service`,
`subscription-service`, and `scheduling-service` after the changes above —
zero regressions is a hard requirement given how much of this phase is
"extend in place." `npm run build` and lint clean, matching the bar every
prior phase report already holds itself to.

---

## 18. Docker / local development

**§49.** No new service, no new container, no new port. Catalog's existing
`docker-compose.yml`/Postgres instance picks up the new migrations
(`013`–`019`) via its existing migration runner (`src/database/
migrations.ts`) — verify it applies cleanly against a fresh DB and is a
no-op on re-run, same bar as every prior phase. `subscription-service`'s
migration for `minor_upgrade_behavior`/`last_resolved_version` (§32) is a
one-line addition to its own existing migrations directory. No `.env`
changes needed beyond the new `DEFAULT_GRACE_PERIOD_DAYS` var on Catalog
(document it in that service's `.env.example`, matching the existing
`HEALTH_WEIGHT_*`-style precedent from Phase 9).

---

## 19. Definition of done

**§50.**

- All new/extended tables migrated, applying cleanly against a fresh DB.
- `activateVersion`/`deprecateVersion`/`retireVersion` extended in place
  (not duplicated), routed through `assertTransition`, with grace periods,
  compatibility-vs-bump validation, and breaking-change approval gating.
- `rollbackVersion` implemented as a distinct action with its own audit
  event type; no history deleted anywhere in this phase.
- Retirement blocked by all six checks unless forced with a required
  reason at `PLATFORM_ADMIN`; blocked attempts audited.
- Compatibility engine covers schema, grain/keys, quality, SLA, delivery
  method, and API contract diffs, with persisted structured diffs.
- Version dependency model implemented; retirement respects it.
- Impact analysis matches the required worked example shape exactly.
- Migration plans implemented; `BREAKING` plans never auto-execute
  subscription moves; `NON_BREAKING` plans can.
- Version resolution centralized in Catalog (`resolve-version`);
  `subscription-service`'s local ranking logic deleted, not duplicated;
  `scheduling-service` unchanged.
- Subscription version policy supports all five named types with the
  `PINNED_MAJOR` vs `COMPATIBLE_MINOR` distinction implemented via
  `minor_upgrade_behavior`.
- BETA versions unreachable except via explicit opt-in, enforced at the
  resolver (not just at the UI/client layer).
- API Delivery supports both default-resolved and explicit-version routes,
  with `/v1` and product-version kept fully separate.
- Publication continues to accept exactly the version it's given, verified
  for DEPRECATED-in-grace-period versions specifically.
- Observability reports the per-version metrics listed in §41.
- Governance metadata columns exist and are populated as nullable/no-ops
  only — no Phase 11 enforcement logic written.
- All tests in §45–§48 pass; zero regressions in existing suites.
- The end-to-end demonstration (§52) runs as a repeatable script/test,
  matching the Phase 9 precedent (`npm run seed-demo` / e2e test suite).

**§51.** Explicitly **not** in scope for Phase 10 (leave for Phase 11 or
later, per the user's own non-goals list): full security/governance
hardening and enforcement of the metadata hooks added in §6; cloud
production deployment; billing/commercialization; a general-purpose
approval/workflow engine (the `version_approvals` table is deliberately a
flat log, not a state machine of its own); customer-editable contracts.

---

## 20. Implementation sequence

**§52.** Suggested order, each step independently testable:

1. Relocate `registration/lifecycle.service.ts` → `modules/lifecycle/`,
   `registration/compatibility.ts` → `modules/compatibility/` (pure move,
   update imports, existing tests still pass).
2. Migrations `013`–`019` (§6–§12) and `REGISTRATION_EVENT_TYPES`/
   `config/constants.ts` updates.
3. Semver extension (§3–§4) + compatibility engine extensions (§13–§15) +
   bump-vs-compatibility validation (§5, §19) — unit-tested in isolation.
4. Transition-rules table (§16) wired into `activate`/`deprecate`/`retire`;
   grace periods (§19–§20).
5. Retirement guard (§21–§22) — build against stub/mock sibling clients
   first, then wire real HTTP calls to Subscription/Scheduling/Publication.
6. Dependency model (§25) and impact analysis (§26).
7. Version resolver in Catalog (§27–§29) + its internal endpoint (§30).
8. Refactor `subscription-service`'s `catalog-client.ts` to call the new
   resolver (§30–§31); add `minor_upgrade_behavior`/`last_resolved_version`
   (§32); fix the contract test (§47).
9. Rollback (§33).
10. Migration plans (§34–§35).
11. Customer-safe API extensions (§36–§37).
12. API Delivery explicit-version route (§38–§39).
13. Publication defensive check (§40).
14. Observability per-version metrics (§41).
15. Full test pass (§45–§48), then the e2e demonstration (§53).

---

## 21. End-to-end demonstration

**§53.** Implement as a repeatable e2e test (matching the Phase 9
precedent of a deterministic assertion suite, e.g. `tests/e2e/
phase10-version-lifecycle.test.ts` in `data-product-catalog-service`,
plus cross-service assertions where the other services are involved) and,
if useful, a runnable demo script analogous to `npm run seed-demo`. Exact
sequence, using `event-performance` as in the existing fixtures:

1. Start with `1.2.0 ACTIVE` (seed, or reuse existing Phase 5 fixture
   state).
2. Register `1.3.0` adding one optional field.
   - Assert `compatibility_type = NON_BREAKING`.
   - Activate `1.3.0` — assert it succeeds without an approval row, assert
     `1.2.0` becomes `DEPRECATED` with `grace_period_end` set and
     `successor_version = "1.3.0"`.
   - Assert a subscription with policy `COMPATIBLE_MINOR("1")` resolves to
     `1.3.0` (intent `SUBSCRIBE` and `DELIVER` both).
   - Assert a subscription with policy `EXACT("1.2.0")` still resolves to
     `1.2.0` (intent `DELIVER`).
3. Register `2.0.0` with a breaking field removal/rename.
   - Assert `compatibility_type = BREAKING`.
   - Assert `activateVersion(..., "2.0.0")` targeting full `ACTIVE`
     rejects without an approval row.
   - Approve it, then activate to `BETA` only.
   - Grant a BETA opt-in to one tenant; assert that tenant's `EXACT
     ("2.0.0")` resolution succeeds and a second, non-opted-in tenant's
     identical policy fails with `VERSION_REQUIRES_BETA_OPT_IN`.
   - Assert normal `1.x`-policy tenants still resolve to `1.3.0`,
     unaffected.
4. Deprecate `1.2.0` explicitly (if not already DEPRECATED from step 2)
   with a short grace period; call the impact-analysis endpoint and assert
   the response shape matches §26's worked example structure (total /
   resolvesToFrom / pinnedToFrom / betaOptedIn / requiresExplicitAction).
5. Attempt `retireVersion("1.2.0")` without `force` — assert
   `VERSION_NOT_RETIRABLE` with `ACTIVE_SUBSCRIPTIONS` (and/or
   `GRACE_PERIOD_NOT_COMPLETE`) in the blocker list, and a
   `VERSION_RETIREMENT_BLOCKED` event recorded.
6. Create a migration plan `1.2.0 → 1.3.0`; execute it (non-breaking, so
   it may auto-move the pinned/EXACT `1.2.0` subscriptions); assert
   `SUBSCRIPTION_MIGRATED` events and the migration plan reaching
   `COMPLETED`.
7. Retire `1.2.0` again — now succeeds without `force` once blockers are
   clear and the grace period has elapsed (advance the clock or use a
   near-zero grace period in the test fixture).
8. Cross-service consistency: trigger a scheduled delivery (via
   `scheduling-service`, real HTTP calls if running services are available
   in the test environment, matching the Phase 9 report's precedent of
   testing against actually-running siblings) for a subscription resolved
   to `1.3.0`; assert the `resolvedProductVersion` Publication receives
   matches exactly what Scheduler resolved; assert API Delivery's explicit-
   version route for `1.3.0` returns data while the same route for
   `1.2.0` still works during its grace period and fails once retired;
   assert Observability's per-version health/adoption endpoint reports
   subscriber counts consistent with the impact-analysis numbers from step
   4.

Report results the same way the Phase 8/9 reports did: a
`docs/phase10-implementation-report.md` written after implementation,
listing what was actually built, test counts, and any real bugs found by
testing against live sibling services (not just mocks) — per this
project's established practice of verifying against actually-running
Phase 1–9 services, which the Phase 9 report notes caught real bugs no
unit test would have.
