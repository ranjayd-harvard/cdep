<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository shape

This repo is **not just the portal** — it's the whole Customer Data Exchange Platform: `cdep` (this
root, the Next.js customer portal, Phase 1) plus nine independently deployable backend services,
each its own directory with its own `package.json`/`tsconfig.json`/`eslint.config.mjs` (or
`pyproject.toml`) and its own git-tracked `node_modules`/`dist`:

| Directory | Phase | Purpose | Stack |
|---|---|---|---|
| `data-exchange-service` | 1/2 | Exchange control plane: upload/download lifecycle, manifests, validation, signed URLs into MinIO | Fastify + PostgreSQL + MinIO |
| `data-lakehouse` | 2/3 | Ingestion → Bronze, then Bronze→Silver→Gold transform pipeline | Python, PyIceberg + PyArrow |
| `data-publication-service` | 4 | Reads a Gold snapshot, projects/exports it, hands the artifact to the Exchange Service as an OUTBOUND exchange | Python, PyIceberg + PyArrow |
| `data-product-catalog-service` | 5 | Authoritative runtime registry for Data Products/versions/schemas/contracts/SLA — fed by Contract-as-Code from Git/CI | Fastify + PostgreSQL |
| `subscription-service` | 6 | Entitlement (may this tenant access X) and Subscription (how do they want it delivered) — kept strictly separate | Fastify + PostgreSQL |
| `scheduling-service` | 7 | Decides *when* a subscribed publication is due/eligible, issues `PublicationRequest` to data-publication-service | Fastify + PostgreSQL |
| `serving-projection-service` | 8 | Projects Gold → tenant-isolated Postgres serving table for API delivery | Python, PyIceberg |
| `data-product-api-service` | 8 | Customer-facing, entitled, cursor-paginated REST reads over the serving store | Fastify + PostgreSQL (reads serving-projection's DB directly) |
| `data-platform-observability-service` | 9 | Correlates every other service's workflow into one operational read model; SLA/health/alerting | Fastify + PostgreSQL |
| `identity-provider` | 11 | Local Keycloak realm standing in for a real OIDC provider (Entra/Okta/Auth0) | Keycloak |

Root tooling (`tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`) explicitly excludes
`data-exchange-service`, `data-product-catalog-service`, `subscription-service`, and
`scheduling-service` — each nested service lints/typechecks/tests only via its own scripts, run
from inside its own directory. Treat every service directory as its own project: `cd` into it
before running its `npm`/Python commands.

`platform/` holds one-command orchestration across all of them — see [Platform-wide orchestration](#platform-wide-orchestration).
`docs/` has cross-service integration write-ups (read before touching an integration boundary,
not just the code) and `docs/security/` has the Phase 11 security design docs (threat model, trust
boundaries, tenant isolation, identity, encryption/secrets, retention).

## Commands (cdep — this root project)

```bash
npm install
npm run dev                 # next dev, http://localhost:3000
npm run build                # next build
npm start                    # next start (production build must exist)
npm run lint                  # eslint
npm test                      # vitest run (single pass)
npm run test:watch            # vitest watch mode
npx vitest run src/path/to/file.test.ts   # single test file
npx vitest run -t "test name substring"    # single test by name
npm run seed:users            # upsert demo/seed accounts into Mongo (src/data/mocks/users.ts)
npm run seed:catalog          # upsert orgs/tenants/dataProducts/datasets/entitlements
npm run create-superuser      # bootstrap a superuser account
npm run security:release-gate # scripts/security/release-gate.ts
```

Every nested service (`data-exchange-service`, `data-product-catalog-service`,
`subscription-service`, `scheduling-service`, `data-product-api-service`,
`data-platform-observability-service`) follows the same Node script shape from inside its own
directory: `npm run dev` (tsx watch), `npm run build` (tsc), `npm test` / `npm run test:watch`
(vitest), `npm run migrate` (hand-written SQL migrations, no ORM), plus a service-specific
`npm run seed`/`npm run demo`. The Python services (`data-lakehouse`, `data-publication-service`,
`serving-projection-service`) use a venv + `pytest` instead — see each one's README for exact
commands, they aren't uniform.

### Platform-wide orchestration

```bash
platform/start.sh                    # bring everything up, wait for health checks
platform/start.sh data-exchange-service   # target just one service (by directory name)
platform/status.sh                   # what's running right now
platform/restart.sh                  # stop then start everything
platform/rebuild.sh [--no-cache]     # rebuild images, then redeploy
platform/stop.sh [--volumes]         # bring everything down (--volumes also deletes data)
platform/platform-init.sh [--yes]    # wipe Mongo/Postgres/MinIO and start over, then bootstrap a superuser
```

## cdep architecture (this root project)

The full platform pipeline: `Customer Portal → Middle-Tier APIs → Data Product Services →
Medallion Lakehouse (Bronze → Silver → Gold)`. This repo's root builds the **Customer Portal**
only; it talks to the rest of the system through TypeScript service interfaces so a mock/HTTP
swap requires no UI changes.

```text
Server Components / Route Handlers (src/app/**)
   → `services` registry (src/services/index.ts) — Mongo-backed, always real
   → MongoDB (+ GridFS for file bytes)

"use client" components
   → `clientServices` registry (src/services/client.ts)
   → Mock Services (src/services/mocks)   [NEXT_PUBLIC_USE_MOCK_SERVICES=true, default]
   or HTTP Services (src/services/http) → this app's own /api/* route handlers → `services` above
```

Every domain capability (`Organization`, `Tenant`, `DataProduct`, `Dataset`, `Entitlement`,
`Exchange`, `Upload`, `Download`, `Notification`, `ApiAccess`, ...) is a TypeScript interface in
`src/services/interfaces/`, with a Mongo implementation (`src/services/mongo/`, backs `services`,
unconditionally real), a mock implementation (`src/services/mocks/`, in-memory fixtures from
`src/data/mocks/`), and an HTTP implementation (`src/services/http/`, calls this app's own
`/api/*` routes) — the latter two back `clientServices`, the only registry `"use client"`
components may import, since Mongo can't ship to a browser bundle.

**Rules enforced in the code, not just convention:**
- UI components never `fetch()` directly — always `services.x.method(...)` / `clientServices.x.method(...)`.
- Tenant identity comes exclusively from the session via `requireTenantContext()` (`src/lib/tenant.ts`,
  pages) or `requireApiTenantContext()` (`src/lib/api-auth.ts`, route handlers) — never from a
  route param, query string, or form field. Every tenant-scoped service method takes `tenantId`
  as its first argument.
- Authorization (`src/lib/authorization.ts`, role-based) is independent of authentication
  (`src/auth.ts`) — the two never share code.

**Authorization chain** (enforced in this order every request):
`User → Organization → Tenant → Entitlement → Data Product → Dataset (+ row-level policy)`.
`entitlements` is the one genuinely tenant-owned Mongo collection in that chain and is only ever
touched through `TenantScopedCollection` (`src/lib/tenant-scoped-collection.ts`), which rejects
(doesn't silently drop) any read/write naming a different tenantId, backed by a `$jsonSchema`
validator requiring `tenantId` at the database layer. A dataset/product a tenant isn't entitled to
returns `null` — identical to "doesn't exist" — so probing another tenant's id confirms nothing.

**Auth** (`src/auth.ts`, Auth.js v5): Credentials (bcrypt) + Google OAuth, both resolved against a
Mongo `users` tenant directory (`src/lib/user-directory.ts`). New signups/first Google sign-ins
have no org/tenant yet and are routed through `/onboarding` (join an existing org, pending admin
approval, or create a new one — instant `CUSTOMER_ADMIN`). Credentials accounts require email
verification before login (`src/lib/auth-tokens.ts`, single-use hashed tokens). JWT sessions
(no DB sessions — unsupported alongside Credentials); the `jwt` callback re-fetches the user
whenever `organizationId` is still null, so onboarding takes effect on the next page load.

**Route protection** is double-enforced: at the edge (`src/proxy.ts`) and again per-page
(`requireTenantContext()` in Server Components).

## Cross-service integration (cdep ↔ data-exchange-service)

Uploads/downloads/exchanges are real, backed by `data-exchange-service` when `EXCHANGE_SERVICE_URL`
is set (unset = fall back to Mongo-only). Full design rationale lives in
`docs/exchange-service-integration.md` — read it before touching either side. Key things to know
without opening that file:

- Server-to-server only: the browser never calls data-exchange-service directly for control-plane
  JSON — only this app's own `/api/*` routes do, via `src/services/exchange-api/*`. The one
  exception is signed MinIO URLs themselves, handed to the browser for the actual bytes.
- `src/lib/exchange-service/token.ts` mints a dev-only unsigned bearer token
  (`AUTH_MODE=development` on the other side) — this must become real OIDC before either service
  reaches production (see `identity-provider` / Phase 11).
- `data-exchange-service/scripts/sync-cdep-catalog.ts` (`npm run sync:cdep`, run from that
  directory) mirrors cdep's **live** Mongo org/tenant/dataset/entitlement collections into that
  service's Postgres — re-run it after creating a new org/tenant/entitlement in cdep, or that
  org gets `ENTITLEMENT_DENIED` on every upload/download.
- `putToSignedUrl` (`src/lib/exchange-service/client.ts`) is built on `node:http`/`node:https`,
  deliberately not `fetch()` — undici's `fetch()` silently fails to honor the `Host` header
  override needed for the Docker-in-Docker storage relay (`EXCHANGE_SERVICE_STORAGE_RELAY_HOST`)
  to satisfy MinIO's SigV4 signature check. Don't "simplify" this back to `fetch()`.
- `ExchangeApiUploadService.publishProcessedOutput` does one of two things once an upload
  completes, gated by `DEMO_FIXTURE_PUBLISH_ENABLED` (default `true`): synchronously fabricate a
  demo OUTBOUND exchange, or enqueue a real job that data-exchange-service's own pipeline worker
  later drives through the real Bronze→Silver→Gold→Publish chain.

## Testing conventions

Vitest + React Testing Library, root config at `vitest.config.mts`. Coverage is a deliberate
foundation, not exhaustive — it checks route-level tenant resolution, tenant scoping in the
`Dataset`/`Exchange` mock services, one representative UI component, and one representative
feature workflow. Add new tests under `src/**/__tests__/` alongside the feature they cover rather
than centralizing them elsewhere. Nested services each have their own Vitest/pytest suite, run
from inside that service's directory.
