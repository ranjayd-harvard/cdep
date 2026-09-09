# Data Exchange Service

The **Exchange Control Plane** for the Customer Data Exchange Platform. It manages inbound
(customer upload) and outbound (customer download) data exchanges: metadata, lifecycle state,
manifests, validation, audit trail, and short-lived signed URLs into object storage.

It is **not** a data warehouse and does not transform business data. It does not implement the
Bronze/Silver/Gold medallion pipeline itself — `data-lakehouse` does, as a real (no longer
future) consumer of this service's `EXCHANGE_READY_FOR_INGESTION` signal. This service can also
*trigger* that pipeline (and the subsequent real Gold→Outbound publish via
`data-publication-service`) for queued jobs via its own `src/pipeline-worker/` — see "Two publish
paths" under Architectural decisions below.

This service is wired up to the `cdep` portal one directory up — see
[`../docs/exchange-service-integration.md`](../docs/exchange-service-integration.md)
for the full integration writeup (auth bridge, catalog/status model
mismatches, the Docker-in-Docker storage relay fix, `scripts/sync-cdep-catalog.ts`).
That doc is the canonical reference for how the two projects fit together;
this README stays focused on this service in isolation.

## Architecture

```text
                            ┌─────────────────────┐
                            │   Customer Portal    │
                            └──────────┬───────────┘
                                       │
                                       │ HTTPS / JWT
                                       ▼
                    ┌──────────────────────────────────┐
                    │        EXCHANGE SERVICE          │
                    │                                  │
                    │ Authentication                   │
                    │ Tenant Authorization              │
                    │ Exchange Lifecycle                │
                    │ Upload / Download URLs            │
                    │ Manifest Management                │
                    │ Validation                        │
                    └───────┬──────────────┬───────────┘
                            │              │
                 ┌──────────▼──────┐ ┌────▼─────────────┐
                 │ Exchange DB     │ │ Object Storage    │
                 │ PostgreSQL      │ │                    │
                 │                 │ │ inbound/           │
                 │ exchanges       │ │ outbound/           │
                 │ files           │ │ manifests           │
                 │ events          │ │ validation          │
                 │ validations     │ │ files                │
                 └─────────────────┘ └─────────┬──────────┘
                                              │
                                   src/pipeline-worker/
                                    (queued jobs only —
                                     see below) │
                                              ▼
                              ┌─────────────────────────┐
                              │ Bronze → Silver → Gold   │
                              │ (data-lakehouse, real)   │
                              └─────────────────────────┘
```

This service does not itself implement Bronze/Silver/Gold — it *triggers*
data-lakehouse's real pipeline (and then data-publication-service's real
publish step) for queued jobs, via `src/pipeline-worker/`. See "Two publish
paths" under Architectural decisions below.

### Multi-tenant security model

```text
Organization
    │
    └── Tenant
          │
          └── User
```

The ownership boundary for every stored object and every database row is
`organization_id + tenant_id`. Users get access through tenant membership + role +
data-product entitlement — never through per-user folders. `RequestContext`
(`userId`, `organizationId`, `activeTenantId`, `role`) is derived only from the validated
token, never from query params, path params, or request bodies.

### Upload sequence

```text
Portal             Exchange Service       PostgreSQL        Object Storage
  │                       │                    │                   │
  │ POST /uploads         │                    │                   │
  ├──────────────────────►│                    │                   │
  │                       │ create exchange    │                   │
  │                       ├───────────────────►│                   │
  │                       │                    │                   │
  │                       │ create signed URL  │                   │
  │                       ├───────────────────────────────────────►│
  │                       │                    │                   │
  │ upload URL            │                    │                   │
  │◄──────────────────────┤                    │                   │
  │                       │                    │                   │
  │ PUT file directly                                             │
  ├───────────────────────────────────────────────────────────────►│
  │                       │                    │                   │
  │ POST /complete        │                    │                   │
  ├──────────────────────►│                    │                   │
  │                       │ HEAD/check object  │                   │
  │                       ├───────────────────────────────────────►│
  │                       │                    │                   │
  │                       │ write manifest     │                   │
  │                       ├───────────────────────────────────────►│
  │                       │                    │                   │
  │                       │ update exchange    │                   │
  │                       ├───────────────────►│                   │
  │                       │                    │                   │
  │ RECEIVED → VALIDATED  │                    │                   │
  │◄──────────────────────┤                    │                   │
```

The service never proxies the file body itself — only the browser talks to object storage for
the actual bytes. `/complete` does one bounded read of the object (for SHA-256 + structural
validation), not a proxy of client→server→storage traffic.

### Download sequence

```text
Portal
   │
   │ request download
   ▼
Exchange Service
   │
   ├── validate user
   ├── validate organization
   ├── validate tenant
   ├── validate entitlement
   ├── validate exchange status (READY)
   └── validate expiration
            │
            ▼
       Object Storage
            │
            │ create signed URL
            ▼
Exchange Service
            │
            ▼
          Portal
            │
            │ direct download
            ▼
       Object Storage
```

### Storage layout

```text
exchange-inbound/
organizations/{organizationId}/tenants/{tenantId}/uploads/YYYY/MM/DD/{exchangeId}/
├── data/{original_filename}
└── metadata/
    ├── manifest.json      (immutable, written once)
    ├── validation.json    (validation outcome)
    └── processing.json    (future downstream processing state)

exchange-outbound/
organizations/{organizationId}/tenants/{tenantId}/downloads/YYYY/MM/DD/{exchangeId}/
├── data/{published_filename}
└── metadata/manifest.json
```

Clients never supply bucket/path/tenant values — the service alone derives every object key
(`src/storage/storage-path-builder.ts`).

## Database ERD (logical)

```text
organizations
      │
      └──── tenants
              │
              ├──── tenant_memberships
              ├──── tenant_data_product_entitlements
              └──── exchanges
                       │
                       ├──── exchange_files
                       ├──── exchange_events   (append-only audit trail)
                       └──── exchange_validations

data_products
      │
      ├──── tenant_data_product_entitlements
      └──── exchanges
```

Migrations live in `migrations/001`–`009` and are applied in order by `npm run migrate` /
`scripts/start.ts` (idempotent — tracked in `public.exchange_schema_migrations`).

Every tenant-owned repository query in `src/modules/exchanges/exchange.repository.ts` requires
`organizationId` + `tenantId` as parameters — there is no code path to query a single exchange by
id alone. `exchange.exchanges` also has Row Level Security enabled (`004_exchanges.sql`) as a
defense-in-depth layer; see that migration's comments for how a future session-scoped middleware
would set `app.organization_id` / `app.tenant_id` per transaction to make it load-bearing.

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/uploads` | JWT | Create an inbound exchange + signed upload URL |
| POST | `/v1/uploads/{exchangeId}/complete` | JWT | Finalize upload, write manifest, run validation |
| GET | `/v1/exchanges` | JWT | List exchanges (tenant-scoped, cursor-paginated) |
| GET | `/v1/exchanges/{exchangeId}` | JWT | Exchange detail |
| GET | `/v1/exchanges/{exchangeId}/events` | JWT | Lifecycle timeline |
| GET | `/v1/exchanges/{exchangeId}/validation` | JWT | Customer-safe validation result |
| GET | `/v1/data-products` | JWT | List active data products |
| POST | `/v1/downloads/{exchangeId}/url` | JWT | Signed download URL for a READY outbound exchange |
| POST | `/internal/v1/publications` | Internal API key | Fixture-content publish simulator — cdep's upload-triggered demo path when `DEMO_FIXTURE_PUBLISH_ENABLED=true` (default) |
| POST | `/internal/v1/outbound-publications` | Internal API key | Real Gold→Outbound handoff from data-publication-service (prepare + signed upload URL) |
| POST | `/internal/v1/outbound-publications/{exchangeId}/complete` | Internal API key | Verifies the uploaded artifact and marks the OUTBOUND exchange READY |
| POST | `/internal/v1/outbound-publications/{exchangeId}/fail` | Internal API key | Marks an OUTBOUND publication FAILED |
| POST | `/internal/v1/pipeline-jobs` | Internal API key | Enqueues a Bronze→Silver→Gold→Publish pipeline run (cdep's upload path when `DEMO_FIXTURE_PUBLISH_ENABLED=false`); processed asynchronously by `src/pipeline-worker/`, not this request |
| GET | `/internal/v1/exchanges/{exchangeId}/manifest` | Internal API key | Manifest + data-file storage coordinates, for the `data-lakehouse` ingestion pipeline (see its `HttpExchangeServiceClient`) |
| GET | `/internal/v1/exchanges` | Internal API key | Cross-tenant exchange list (no org/tenant scoping), for the portal's superadmin `/admin/lakehouse` page |
| GET | `/health/live` | none | Process liveness |
| GET | `/health/ready` | none | PostgreSQL + object storage readiness |
| GET | `/docs` | none | Swagger UI (OpenAPI) |

## Running locally

Exposed locally: Exchange API `localhost:8080`, PostgreSQL `localhost:5433` (mapped off the
default 5432 to avoid clashing with a locally-installed Postgres — the container's internal
port is still 5432), MinIO API `localhost:9000`, MinIO Console `localhost:9001`.

```bash
cp .env.example .env   # then edit hosts to localhost (and the Postgres port, if you changed it) if running the app outside Docker
docker compose up -d postgres minio
npm install
npm run migrate
npm run buckets:init
npm run seed
npm run dev
```

Or run everything in Docker:

```bash
docker compose up --build
```

`AUTH_MODE=development` (the default outside production) accepts an unsigned base64url JSON
payload as the bearer token — e.g. `{"sub":"usr-8a74b91","organization_id":"org-vobis-org-722aea","active_tenant_id":"tenant-default-47d849","role":"CUSTOMER_ADMIN"}`
base64url-encoded — or no `Authorization` header at all, which falls back to that same seeded
identity. This path is refused at boot when `NODE_ENV=production` (see `src/config/env.ts`).

### Sample requests

```bash
DEV_TOKEN=$(node -e "console.log(Buffer.from(JSON.stringify({sub:'usr-8a74b91',organization_id:'org-vobis-org-722aea',active_tenant_id:'tenant-default-47d849',role:'CUSTOMER_ADMIN'})).toString('base64url'))")

# 1. Initiate an upload
curl -s -X POST http://localhost:8080/v1/uploads \
  -H "Authorization: Bearer $DEV_TOKEN" -H "Content-Type: application/json" \
  -d '{"dataProductId":"event-data","filename":"events_20260904.csv","contentType":"text/csv","sizeBytes":62,"schemaVersion":"2.1"}'
# => { "exchangeId": "exc-...", "status": "PENDING_UPLOAD", "upload": { "url": "...", ... } }

# 2. PUT the file straight to object storage using the returned URL
curl -s -X PUT "<upload.url from step 1>" -H "Content-Type: text/csv" \
  --data-binary $'event_id,event_type,occurred_at\nevt-1,click,2026-09-04T00:00:00Z\n'

# 3. Complete the exchange
curl -s -X POST http://localhost:8080/v1/uploads/<exchangeId>/complete \
  -H "Authorization: Bearer $DEV_TOKEN"

# 4. Publish a fixture outbound exchange (internal)
curl -s -X POST http://localhost:8080/internal/v1/publications \
  -H "x-internal-api-key: dev-internal-key-change-me" -H "Content-Type: application/json" \
  -d '{"organizationId":"org-vobis-org-722aea","tenantId":"tenant-default-47d849","dataProductId":"event-performance","filename":"event-performance-20260904.csv"}'

# 5. Request a signed download URL
curl -s -X POST http://localhost:8080/v1/downloads/<exchangeId>/url \
  -H "Authorization: Bearer $DEV_TOKEN"

# 6. Enqueue a real pipeline run instead (what cdep calls when
#    DEMO_FIXTURE_PUBLISH_ENABLED=false, in place of step 4). Processed
#    asynchronously by src/pipeline-worker/, not this request — see
#    PIPELINE_WORKER_POLL_INTERVAL_MS.
curl -s -X POST http://localhost:8080/internal/v1/pipeline-jobs \
  -H "x-internal-api-key: dev-internal-key-change-me" -H "Content-Type: application/json" \
  -d '{"organizationId":"org-vobis-org-722aea","tenantId":"tenant-default-47d849","dataProductId":"event-performance","exchangeId":"<exchangeId from step 1>"}'
```

## Testing

```bash
docker compose up -d postgres minio
npm run migrate
npm run buckets:init
npm run seed
npm test
```

Unit tests (`src/tests/unit`) cover pure logic (filename/path/checksum, state transitions,
structural validation). Integration tests (`src/tests/integration`) run the real Fastify app
in-process (`app.inject`) against the real PostgreSQL + MinIO containers, and cover:
create → upload → complete → manifest → validation → events lifecycle, idempotent
initiate/complete, oversize/zero-byte/unsupported-type rejection, entitlement enforcement,
cross-tenant isolation (list/detail/events/validation/complete/download all fail closed as
404/not-found), outbound publication, signed download authorization, expired-exchange
rejection, checksum metadata, and health checks.

## Architectural decisions

- **No distributed transactions.** PostgreSQL and object storage are never committed together.
  Storage writes are designed to be safely retried, and `src/reconciliation/reconciliation.service.ts`
  documents how drift (e.g. an object PUT with no matching `/complete` call) is detected and
  resolved. It is a plain function, not a scheduler — wiring a periodic caller is a future step.
- **Manifests are immutable.** `manifest.json` is written once at completion/publication and
  never overwritten. Mutable lifecycle state lives in the sibling `validation.json` /
  `processing.json` sidecars instead.
- **RLS is prepared, not load-bearing.** `exchange.exchanges` has an RLS policy keyed on
  `app.organization_id` / `app.tenant_id` session variables, but `FORCE ROW LEVEL SECURITY` is
  intentionally not enabled — the mandatory `organization_id`/`tenant_id` predicate in every
  repository query is the primary enforcement mechanism for this phase.
- **Presigned URLs use a separate public endpoint.** Inside docker-compose the service reaches
  MinIO at `minio:9000`, but a browser on the host can only reach `localhost:9000`. URLs are
  *signed* against `OBJECT_STORAGE_PUBLIC_ENDPOINT` while server-side PUT/GET/HEAD use the
  internal `OBJECT_STORAGE_ENDPOINT`.
- **`/complete` reads the object once.** Computing a true SHA-256 and running structural
  validation requires the bytes; this is a single bounded read of one already-uploaded object,
  not a proxy of the original (potentially multi-GB) upload transfer.
- **No identity provider.** `AUTH_MODE=development` decodes (does not verify) a token shaped
  like the real claims; `AUTH_MODE=oidc` is stubbed to fail closed until a real JWKS verifier is
  wired in. Refused at boot in production if still set to `development`.
- **Two independent publish paths, chosen by the caller.** `/internal/v1/publications` (fixture
  content, synchronous) and `/internal/v1/pipeline-jobs` → `src/pipeline-worker/` (real
  Bronze→Silver→Gold→Publish, asynchronous) both produce an OUTBOUND exchange but are not layered
  on top of each other — cdep picks one per upload via its own `DEMO_FIXTURE_PUBLISH_ENABLED` flag.
  See `../docs/pipeline-job-queue-design.md` for the full design record.
- **The pipeline worker is a single poll loop, not a distributed queue.** `claimNextPendingJob`'s
  `FOR UPDATE SKIP LOCKED` makes it safe to run more than one worker process, but only one process
  is started today (from `server.ts`, gated on `LAKEHOUSE_SERVICE_URL`/`PUBLICATION_SERVICE_URL`
  both being set). A failed job is left `FAILED` for manual inspection — no retry/backoff yet.

## Remaining future integration points

- Real OIDC/JWKS verification for `AUTH_MODE=oidc`.
- `IngestionNotifier` adapter beyond `LoggingIngestionNotifier` (Kafka/EventBridge/Pub-Sub/etc.)
  consuming `EXCHANGE_READY_FOR_INGESTION`.
- Retry/backoff for `FAILED` pipeline_jobs rows, and an admin UI to list/re-enqueue them
  (currently DB-inspection only — see `src/pipeline-worker/` and
  `../docs/pipeline-job-queue-design.md`).
- A scheduler invoking `reconcileOrphanExchanges()` periodically.
- `FORCE ROW LEVEL SECURITY` plus a low-privilege application DB role, once a connection-scoped
  middleware sets `app.organization_id`/`app.tenant_id` per request.
- Malware scanning hook for uploaded objects (file-scan state can be represented via a new
  `exchange_files` role/status column; no scanning product is wired up).

## What this service explicitly does NOT do

Transform business data, implement Bronze/Silver/Gold, query Gold tables, perform analytics,
act as a data warehouse, expose storage credentials, or allow customers to browse arbitrary
storage paths.
