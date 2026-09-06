# cdep ↔ data-exchange-service integration

Status as of 2026-09-04: **wired and verified end-to-end** against the real,
running stack (real Postgres, real MinIO, real portal container) — uploads,
exchange listing/detail, the auto-publish-on-upload step, and signed
downloads all confirmed working. Read this before touching either side of
the integration; it explains *why* things are shaped the way they are, not
just what the code does.

## Why two separate projects

`data-exchange-service` (`/data-exchange-service`) is an independent
Fastify + PostgreSQL + MinIO service — the exchange control plane and
secure storage gateway. `cdep` (this app) is the customer-facing Next.js
portal. They are deliberately **not** merged into one deployable:

- Different datastores for different concerns (MongoDB for portal/auth
  data, PostgreSQL for exchange control-plane data with row-level tenant
  isolation).
- Different lifecycles — data-exchange-service's `EXCHANGE_READY_FOR_INGESTION`
  signal is meant to eventually feed a Bronze/Silver/Gold pipeline that has
  nothing to do with this portal's deploy cadence.
- Narrower blast radius — data-exchange-service holds storage credentials
  and signs URLs; keeping it a separate process limits what's reachable if
  the portal is compromised.

Both projects live in the same git working tree for convenience during
development (`data-exchange-service/` nested under this repo root) but are
excluded from each other's tooling — see `tsconfig.json`'s `exclude`,
`eslint.config.mjs`'s `globalIgnores`, and `vitest.config.mts`'s `exclude`,
all of which explicitly skip `data-exchange-service/**` (its own
`package.json`/`tsconfig.json`/`eslint.config.mjs` own its own linting).

## Architecture: server-to-server, not browser-to-exchange-service

```text
Browser
  │  (multipart POST /api/uploads, GET pages, POST /api/downloads/*/url)
  ▼
cdep Next.js server (route handlers + Server Components)
  │  services.{exchanges,uploads,downloads}  — src/services/index.ts
  ▼
ExchangeApi*Service (src/services/exchange-api/*)
  │  mints a dev bearer token from the session's TenantContext
  ▼
data-exchange-service HTTP API (EXCHANGE_SERVICE_URL)
  │  returns a signed MinIO URL (upload PUT target, or download GET target)
  ▼
Browser ─────────────────────────────────────────────► MinIO (direct)
```

The browser **never** calls data-exchange-service directly for control-plane
JSON (create exchange, list exchanges, request a download URL) — it only
ever talks to this app's own `/api/*` routes, exactly as before this
integration. Two reasons, not just convention:

1. **CORS / mixed content** — `EXCHANGE_SERVICE_URL` may be `http://` on a
   `localhost` dev box; a real deployment would have TLS/hostname
   mismatches to solve for browser-to-service calls that server-to-server
   calls don't have.
2. **The auth bridge below must never reach a browser.** It's a stand-in
   for real per-request verification, not a secret in its own right, but
   there is no reason to widen its blast radius by shipping it client-side
   when nothing requires that.

The one deliberate exception is the **signed URLs themselves** — those are
handed to the browser and it *does* talk to MinIO directly for the actual
bytes, on the download side. See "Upload path: proxied, not
direct-to-storage" below for why the upload side doesn't (yet) follow the
same pattern.

## Auth bridge (dev-only)

`src/lib/exchange-service/token.ts` mints the bearer token
data-exchange-service's `AUTH_MODE=development` middleware accepts: a
base64url JSON payload shaped like the real JWT claims
(`{sub, organization_id, active_tenant_id, role}`), **not a signed token**
— that service decodes it without verifying a signature.

This is safe only because data-exchange-service refuses to boot with
`AUTH_MODE=development` when `NODE_ENV=production` (see that service's
`src/config/env.ts`), so this bridge cannot reach a production deployment
by accident. **Before either service ships to production**, this needs to
become real OIDC:

1. data-exchange-service's `verifyProductionJwt()` (currently a stub that
   throws `UNAUTHENTICATED`, in its `src/auth/auth.middleware.ts`) needs a
   real JWKS-based verifier.
2. cdep needs to either mint a signed JWT server-side (e.g. via a shared
   signing key or a proper OIDC client-credentials flow to data-exchange-service's
   future IdP) instead of the base64url passthrough in `token.ts`.
3. `mintDevToken` and the `AUTH_MODE=development` path on the other side
   both get deleted together.

### Role mapping

No mapping table needed — deliberately. cdep's `UserRole` enum
(`src/models/user.ts`) has `SUPERUSER`, `CUSTOMER_ADMIN`, `CUSTOMER_USER`,
`CUSTOMER_READONLY`; data-exchange-service's role set (AGENTS.md there,
§5) is `CUSTOMER_ADMIN`, `CUSTOMER_USER`, `CUSTOMER_READONLY`,
`SERVICE_ACCOUNT`, `PLATFORM_ADMIN`. The three that overlap are spelled
identically, and `SUPERUSER` never reaches `mintDevToken` in the first
place: both `requireTenantContext()` (`src/lib/tenant.ts`) and
`requireApiTenantContext()` (`src/lib/api-auth.ts`) reject superusers (and
incomplete-onboarding sessions) before a `TenantContext` is ever
constructed. If a 6th cdep role or an exchange-service `SERVICE_ACCOUNT`/
`PLATFORM_ADMIN` caller is ever needed here, add an explicit map in
`token.ts` then — don't assume the string identity holds forever.

## Organization/Tenant id alignment

data-exchange-service's control-plane database mirrors cdep's **actual,
live** MongoDB catalog — organizations, tenants, datasets, and
entitlements — via `data-exchange-service/scripts/sync-cdep-catalog.ts`,
run as `npm run sync:cdep` in that project (separate from its own `npm run
seed`, which keeps seeding the original `org-vobis-.../org-globex-...`
*fictional* fixtures that service's own test suite depends on — not to be
confused with the real `org-vobis-org-722aea` covered below).

This *replaced* an earlier version of this integration that hardcoded a
snapshot of just the two seeded mock orgs
(`org-acme-live-001`/`org-globex-events-002`) into a static seed script.
That broke the first time it mattered: a real user, testing the actual
onboarding flow, created an organization named "Vobis Org" — cdep's real
id-generation landed on `org-vobis-org-722aea` /
`tenant-default-47d849`, and cdep's real entitlement-granting UI gave it
access to `dp-customer-insights` and `dp-events-operations`. None of that
touches the mock catalog, so the hardcoded snapshot never knew this org
existed — every upload/download attempt failed with `ENTITLEMENT_DENIED`
(`Error [ExchangeServiceError]: This tenant is not entitled to upload
this data product.`), correctly from data-exchange-service's point of
view (it had genuinely never heard of the org), incorrectly from the
user's (cdep itself was happy to let them pick that dataset — the two
services had drifted).

The fix wasn't another hardcoded entry — it was reading cdep's
`organizations`/`tenants`/`datasets`/`entitlements` Mongo collections
directly instead of copying a point-in-time snapshot of them. cdep's own
`scripts/seed-catalog.ts` and its real onboarding/entitlement-granting UI
write into those exact same collections — nothing in Mongo distinguishes
"mock" rows from "real" ones — so reading them live is both simpler and
correct by construction: whatever cdep actually knows about, running
`npm run sync:cdep` makes this service know about too, automatically,
including every org created after this doc was written.

This is what makes `mintDevToken` work with **no separate mapping table**:
a cdep session's `organizationId`/`tenantId` are always valid
data-exchange-service ids, because they were read from the exact same
database cdep itself authenticates against.

**Run `npm run sync:cdep` again after creating a new org, tenant, or
entitlement grant in cdep** — it's on-demand, not automatic (see "Future
work"). Requires `CDEP_MONGODB_URI` (and optionally
`CDEP_MONGODB_DATABASE`) in `data-exchange-service/.env`, matching cdep's
own `MONGODB_URI`.

### Catalog model mismatch

cdep has a three-tier catalog: `DataProduct` (`dp-*`, e.g.
`dp-events-operations`) → `Dataset` (`ds-*`, e.g. `ds-event-performance`,
via `Dataset.dataProductId`) → `Exchange`/`UploadRequest.datasetId`.
Entitlements are granted at the **DataProduct** level (cdep's
`entitlements` collection).

data-exchange-service has only **one** tier: `data_products`
(`exchange.data_products`), with `exchange.exchanges.data_product_id`
pointing straight at it, and `tenant_data_product_entitlements` granted at
that same level.

`sync-cdep-catalog.ts` resolves this by treating each cdep **Dataset** as
a data-exchange-service data product in its own right
(`ds-event-performance` is a row in `exchange.data_products`, not
`dp-events-operations`) — that's the granularity uploads/downloads
actually happen at in cdep today. Every synced row is `direction =
'BIDIRECTIONAL'` (data-exchange-service's entitlement check only looks at
`can_upload`/`can_download` booleans, not `direction` — see that
service's `data-product.service.ts`), and `can_upload`/`can_download` are
both set to whatever cdep's DataProduct-level entitlement resolves to for
that Dataset's parent (cdep doesn't distinguish upload-vs-download
entitlement, so neither does this mapping).

## Status/model mismatches

`src/lib/exchange-service/status-mapping.ts` collapses
data-exchange-service's richer lifecycle (12 inbound + 5 outbound
statuses) onto cdep's narrower `ExchangeStatus`/`UploadStatus` enums (5
and 6 values respectively, predating this integration). Two rules worth
internalizing before changing this file:

- **`VALIDATED` maps to `COMPLETED`, not `PROCESSING`.** This was a real
  bug caught during live testing, not a design choice made up front:
  `/v1/uploads/{id}/complete` runs validation synchronously and returns
  `VALIDATED` (success) or `VALIDATION_FAILED` — full stop. Nothing in
  this integration moves an exchange on to `QUEUED_FOR_INGESTION`/
  `PROCESSING`/`COMPLETED` afterward (there's no async ingestion worker
  yet). Mapping `VALIDATED` → `PROCESSING` left the dashboard's
  `activeStatuses` filter counting every successful upload as
  perpetually "active" forever, `completedThisMonth` never incrementing,
  `upload-form.tsx`'s `isComplete` check never true, and
  `ExchangeApiUploadService.publishProcessedOutput` (gated on
  `status === COMPLETED`) never firing. `QUEUED_FOR_INGESTION`/
  `PROCESSING`/`PREPARING` are still mapped to `ExchangeStatus.PROCESSING`/
  `UploadStatus.PROCESSING` for forward-compatibility, in case a future
  async pipeline does reach those states.
- The full-fidelity status string is still available from
  `getExchange()`'s raw `ExchangeDetail.status` (see
  `src/lib/exchange-service/client.ts`) if a future UI needs more
  granularity than the collapsed 5/6-value enums provide — widening
  `ExchangeStatus`/`UploadStatus` themselves is a bigger, separate UI
  change (`StatusBadge`, dashboard filtering, etc. all switch on the
  current values).

Known small gaps, left as-is rather than worked around:

- **`Exchange.correlationId`** — data-exchange-service's exchange detail
  response doesn't return a correlation id today.
  `ExchangeApiExchangeService` uses the exchange id itself as a stand-in
  (see that file). Real fix: add `correlationId` to that service's
  `GET /v1/exchanges/{id}` response.
- **`Exchange.completedAt` stays `null` for a `COMPLETED`-mapped
  (`VALIDATED`) exchange** — data-exchange-service only ever sets its own
  `completed_at` column for its *own* `COMPLETED` status, which nothing
  reaches in this integration. Cosmetic only (`exchange-detail.tsx` renders
  `—` for a null date); not worth threading a synthetic timestamp through.
- **`getExchanges()`/`getDownloads()` are N+1** — data-exchange-service's
  list endpoint (`GET /v1/exchanges`) intentionally omits per-file detail
  to stay cheap at scale; cdep's list UI wants `filename`, so each summary
  is enriched with a `getExchange()` detail call. Fine at demo/portal
  scale; would need a batched "list with file info" endpoint if exchange
  volume grows.

## Upload path: proxied, not direct-to-storage

data-exchange-service's own architecture (see its AGENTS.md/README)
explicitly wants browsers PUTting straight to a signed URL, never through
the service. `ExchangeApiUploadService` (`src/services/exchange-api/exchange-api-upload-service.ts`)
does **not** follow that for the browser→portal leg: `upload-form.tsx`
still does a single multipart `POST /api/uploads` with the whole file,
exactly as `MongoUploadService` always has, and the Next.js **server**
does initiate → PUT-to-signed-URL → complete on the browser's behalf.

This is a deliberate, scoped tradeoff, not an oversight: rewiring
`upload-form.tsx`/`HttpUploadService` to a two-step direct-to-storage flow
(request a signed URL client-side, PUT directly from the browser, then
notify the server to complete) is a real frontend change, separate from
"make uploads real." What exists today is a fully real exchange lifecycle
(real exchange row, real MinIO object, real manifest, real validation)
with one extra hop for the file bytes. Fine for `MAX_UPLOAD_SIZE_BYTES`-sized
files; would matter for large ones.

**Future work**: switch `upload-form.tsx` to request a signed URL via a
small new endpoint, PUT directly to MinIO from the browser, then call
`/api/uploads/:id/complete`-equivalent — removing the proxy hop and
`putToSignedUrl` entirely.

## Docker-in-Docker: the storage relay host problem

Because of the proxy design above, the *portal's own server* sometimes
needs to PUT bytes to the MinIO URL data-exchange-service signs. That URL's
hostname is whatever data-exchange-service's `OBJECT_STORAGE_PUBLIC_ENDPOINT`
says — typically `localhost:9000`, correct for a real browser or for this
app run via `npm run dev` directly on the host.

**When this app itself also runs inside Docker** (`docker-compose.yml`),
container-internal `localhost` is the container, not the host — that PUT
fails with `ECONNREFUSED` even though the signed URL is perfectly valid.
Confirmed by testing (see below) that `host.docker.internal:9000` *is*
reachable from inside the portal container; the incompatible part is only
that the signed URL says `localhost:9000`.

Fix: `EXCHANGE_SERVICE_STORAGE_RELAY_HOST` (server-only env var,
`src/config/env.ts`) redirects the TCP connection to a reachable host
(`host.docker.internal:9000`) while sending an explicit `Host: localhost:9000`
header — matching what the URL's SigV4 signature (`X-Amz-SignedHeaders=host`)
was actually computed against, so MinIO still accepts it.

**This does not work with `fetch`.** Verified empirically, twice, against
a real presigned URL: undici's `fetch()` silently does not honor a
caller-supplied `Host` header override on the wire (it appears to set it,
but MinIO rejects the request with `SignatureDoesNotMatch`, proving the
actual outgoing request still carried the connection-target's host, not
the one exchange requested). `node:http`/`node:https`'s `request()` does
not have that restriction and was confirmed to work
(`putToSignedUrl` in `src/lib/exchange-service/client.ts` is built
directly on those modules for exactly this reason — don't "simplify" it
back to `fetch()`).

Downloads need none of this — `requestDownloadUrl`'s result goes straight
to the real browser via `window.location.assign(url)`
(`download-button.tsx`) or the `/api/downloads/[fileId]/url` JSON
response, never through `putToSignedUrl` or any server-side fetch.

## Environment variables

All server-only (no `NEXT_PUBLIC_` prefix) unless noted. See
`.env.example` for the canonical list with inline comments.

| Variable | Where used | Notes |
|---|---|---|
| `EXCHANGE_SERVICE_URL` | `src/config/env.ts` → `env.exchangeServiceUrl`/`exchangeServiceEnabled` | Unset = fall back to Mongo-backed services entirely (non-breaking default). `http://localhost:8080` outside Docker, `http://host.docker.internal:8080` when the portal runs in its own docker-compose. |
| `EXCHANGE_SERVICE_INTERNAL_API_KEY` | `ExchangeApiUploadService.publishProcessedOutput` | Must match data-exchange-service's own `INTERNAL_API_KEY`. Empty = publish-on-upload step is silently skipped (upload itself still succeeds). |
| `EXCHANGE_SERVICE_STORAGE_RELAY_HOST` | `putToSignedUrl` | Only needed when this app runs in Docker — see previous section. Empty everywhere else. |
| `NEXT_PUBLIC_API_BASE_URL` | `src/lib/http-client.ts` (client-side `Http*Service`s) | **Must stay empty.** Pre-existing landmine fixed by this integration — it was set to `http://localhost:8080` in `.env.local`, which would have made the *browser* call data-exchange-service paths directly (which don't exist there — data-exchange-service has `/v1/downloads/...`, not `/api/downloads/...`) and 404. Client code only ever calls this app's own `/api/*`. |
| `NEXT_PUBLIC_USE_MOCK_SERVICES` | `src/services/client.ts` | Must be `false` for uploads/downloads to actually reach the server (`true` routes them to in-memory mocks client-side, bypassing everything above). Independent of `EXCHANGE_SERVICE_URL` — this flag governs the *client* registry, `EXCHANGE_SERVICE_URL` governs the *server* registry (`src/services/index.ts`). |

## Running the combined stack locally

Easiest: `platform/start.sh` from the cdep repo root brings up both
services (and any more added later) in one command — see
`platform/README.md`. Manually, or to understand what it's doing:

```bash
# 1. data-exchange-service: infra + app
cd data-exchange-service
docker compose up -d postgres minio
npm install && npm run migrate && npm run buckets:init
npm run seed          # original demo/test fixtures (org-vobis-.../org-globex-... — fictional, not cdep's real org of the same-ish name)
# Add CDEP_MONGODB_URI to .env first (see .env.example), then:
npm run sync:cdep     # mirrors cdep's REAL organizations/tenants/datasets/entitlements
npm run dev           # or: docker compose up -d exchange-service

# 2. cdep: point it at the running exchange service
cd ..
cp .env.example .env.local   # already has EXCHANGE_SERVICE_URL=http://localhost:8080
npm install && npm run dev
```

Or fully dockerized (what was actually used to verify this integration):
`.env` at the cdep root already has `EXCHANGE_SERVICE_URL=http://host.docker.internal:8080`
and `EXCHANGE_SERVICE_STORAGE_RELAY_HOST=host.docker.internal:9000` —
`docker compose up -d --build portal` after data-exchange-service's own
stack is up.

**After creating a new org/tenant/entitlement in cdep** (a real signup,
or granting a new entitlement through the UI), re-run `npm run sync:cdep`
in data-exchange-service — otherwise that org will hit
`ENTITLEMENT_DENIED` on every upload/download, exactly as
`org-vobis-org-722aea` did before this doc's "Organization/Tenant id
alignment" section was rewritten. This is not automatic yet — see
"Future work".

## What was actually verified (not just implemented)

Run against the real, running stack — real Postgres, real MinIO, the real
`cdep-portal-1` Docker container, the real seeded user
(`ranjayd@gmail.com` / `CUSTOMER_ADMIN` / `org-acme-live-001` /
`tenant-acme-live-default-001`):

1. Logged in via the real credentials flow (`/api/auth/callback/credentials`).
2. `POST /api/uploads` with a real multipart CSV → real
   `initiateUpload` → real signed PUT to MinIO (through the Docker-in-Docker
   relay fix) → real `completeUpload` → response `status: "COMPLETED"`.
3. Confirmed in data-exchange-service's own Postgres: a real `INBOUND`
   exchange row, `status = VALIDATED`.
4. Confirmed `publishProcessedOutput` fired: a real `OUTBOUND` exchange
   row, `status = READY`, created via `/internal/v1/publications`.
5. `/exchanges` and `/exchanges/{id}` (real Server Component pages,
   authenticated cookie session) render the real exchange — correct
   filename, record count (3, matching the uploaded CSV), "Completed"
   status badge, dataset name.
6. `/downloads` page lists the auto-published file.
7. `GET /api/downloads/{id}/url` returns a real MinIO presigned GET URL;
   fetching it returns the real fixture file content.

Not (yet) re-verified live after this integration, but covered by
data-exchange-service's own test suite (which this integration relies on
rather than re-proving): cross-tenant isolation, expired-exchange
rejection, checksum metadata, idempotent upload initiation/completion.

**Second round, after a real user hit `ENTITLEMENT_DENIED`** (see
"Organization/Tenant id alignment" above): confirmed via `mongosh` against
the real `cdep-mongo-1` container that `org-vobis-org-722aea` was a real,
non-mock org with real entitlements; ran `npm run sync:cdep` and confirmed
it picked up all three orgs (the two mock ones plus this real one) without
any code change; replayed the exact failing request
(`POST /v1/uploads` with `dataProductId: "ds-event-performance"`,
`organizationId: "org-vobis-org-722aea"`, `tenantId: "tenant-default-47d849"`)
directly against data-exchange-service — `403 ENTITLEMENT_DENIED` before
the sync, `200` with a valid signed URL after, and ran it through to
`complete` → `VALIDATED`. (Could not re-verify through the actual portal
session for this specific org — it's a real user's real password, not one
this session has — but the request replayed is byte-for-byte what
`ExchangeApiUploadService` sends on that user's behalf.)

## Future work

- Real OIDC (see "Auth bridge" above) before either service is
  production-facing.
- Direct-to-storage browser uploads (see "Upload path" above), removing
  `putToSignedUrl`/the relay-host workaround entirely for the upload
  side.
- **Make `sync-cdep-catalog.ts` run automatically** instead of on-demand
  — it's a real gap, not a hypothetical one (see "Organization/Tenant id
  alignment" above for the incident that proved it). Options, roughly in
  order of effort: (a) a `postinstall`/cron-style periodic re-sync in
  dev; (b) cdep calls a small admin endpoint on data-exchange-service
  directly from its onboarding/entitlement-granting Server Actions, so a
  new org is provisioned there the moment it's created in cdep, no
  polling or manual script run needed; (c) the reverse — data-exchange-service
  exposes nothing new, and this stays a manually-triggered script, just
  documented more prominently (current state).
- `correlationId` on data-exchange-service's exchange detail response
  (see "Status/model mismatches").
- A batched "list exchanges with file info" endpoint to remove the N+1 in
  `getExchanges()`/`getDownloads()` if exchange volume grows.

## File map

New files (this integration):

```text
src/lib/exchange-service/
  client.ts            data-exchange-service HTTP client (server-only)
  token.ts              dev auth-bridge token minting
  status-mapping.ts     ExchangeStatus/UploadStatus <-> data-exchange-service status collapsing
src/lib/client-tenant-context.ts   session -> TenantContext for "use client" components
src/services/exchange-api/
  exchange-api-exchange-service.ts
  exchange-api-upload-service.ts
  exchange-api-download-service.ts
  index.ts
src/test/fake-tenant-context.ts    test helper for the widened service interfaces
data-exchange-service/scripts/sync-cdep-catalog.ts   live catalog sync from cdep's MongoDB (see above)
docs/exchange-service-integration.md         this file
platform/                                    start/stop/restart/status scripts for the whole platform
```

Changed files (widened `ExchangeService`/`UploadService`/`DownloadService`
to take a full `TenantContext` instead of a bare `tenantId`, and wired
`EXCHANGE_SERVICE_URL`-gated selection into the server registry):

```text
src/services/interfaces/{exchange,upload,download}-service.ts
src/services/mongo/mongo-{exchange,upload,download}-service.ts
src/services/mocks/mock-{exchange,upload,download}-service.ts
src/services/http/http-{exchange,upload,download}-service.ts
src/services/index.ts
src/config/env.ts
src/app/(portal)/{dashboard,exchanges,exchanges/[exchangeId],downloads}/page.tsx
src/app/(portal)/downloads/download-button.tsx
src/components/upload/upload-form.tsx
src/app/api/uploads/route.ts
src/app/api/downloads/[fileId]/url/route.ts
src/services/mongo/__tests__/*, src/services/mocks/__tests__/*
.env, .env.local, .env.example, docker-compose.yml
eslint.config.mjs, tsconfig.json, vitest.config.mts (exclude data-exchange-service/)
data-exchange-service/package.json (added sync:cdep script, mongodb devDependency)
data-exchange-service/.env.example (added CDEP_MONGODB_URI/CDEP_MONGODB_DATABASE)
```
