# Customer Data Exchange Portal

**Data Exchange** — *Securely exchange data with your organization*

Phase 1 of an enterprise Data Exchange Platform: the customer-facing portal. It lets a customer sign in, see what data products they're entitled to, track inbound/outbound exchanges, upload files, download outputs, and manage API access. The Organization/Tenant/Entitlement/Catalog chain, and Uploads/Downloads/Exchanges/Notifications, are all real and persisted (MongoDB, including GridFS for file bytes — see [Service Architecture](#service-architecture)); this app is its own backend for Phase 1. No separate middle tier, real data-transform pipeline, or lakehouse exists yet — this repository establishes the frontend architecture and contracts those will plug into later.

## Overview

The full platform will eventually look like:

```text
Customer Portal → Middle-Tier APIs → Data Product Services → Medallion Lakehouse (Bronze → Silver → Gold)
```

This repository builds **only the Customer Portal**. It talks to the rest of the system through TypeScript service interfaces, currently backed by in-memory mock implementations, so that swapping in real APIs later requires no UI changes — only a new implementation of each interface and one environment variable.

Explicitly out of scope for Phase 1: the lakehouse, Kafka, Databricks/Snowflake/Redshift, S3, SFTP, a real API gateway, a database, a data pipeline, a schema registry, real secrets management, and enterprise SSO. See [Future Integration](#future-integration).

## Architecture

```text
Server Components / Route Handlers (src/app/**)
   ↓
`services` registry (src/services/index.ts) — Mongo-backed, always real
   ↓
MongoDB (+ GridFS for file bytes)

Browser ("use client" components)
   ↓
`clientServices` registry (src/services/client.ts)
   ↓
Mock Services (src/services/mocks)          ← NEXT_PUBLIC_USE_MOCK_SERVICES=true (default)
   or
HTTP Services (src/services/http) → this app's own /api/* route handlers → `services` registry above

FUTURE:

Browser
   ↓
Next.js Customer Portal
   ↓
Middle Tier APIs
   ↓
Data Product Services
   ↓
Bronze → Silver → Gold (Medallion Lakehouse)
```

Key architectural rules enforced in the code:

- **UI components never fetch data directly.** They call `services.datasets.getDatasets(...)`, never `fetch("/api/...")`. See `src/services/index.ts`.
- **Tenant identity always comes from the session, never from the browser.** Every service method takes `tenantId` as its first argument, and that value is only ever produced by `requireTenantContext()` (`src/lib/tenant.ts`), which reads the authenticated session. No page accepts a tenant ID from a route param, query string, or form field.
- **Authorization is independent of authentication.** `src/lib/authorization.ts` makes role-based decisions (e.g. who can upload data) without knowing anything about how the user signed in.

## Local Development

Requires Node.js 24+ and npm.

```bash
npm install
cp .env.example .env.local   # then set AUTH_SECRET — see below
npm run dev
```

Generate a secret for `.env.local`:

```bash
npx auth secret
# or: openssl rand -base64 32
```

Visit [http://localhost:3000](http://localhost:3000) — you'll be redirected to `/login`.

### Demo accounts

All accounts use the password **`portal-demo`**.

| Email | Organization | Tenant | Role |
|---|---|---|---|
| `ranjayd@gmail.com` | Acme Live Entertainment | Default | Customer Admin |
| `morgan.lee@acmelive.example.com` | Acme Live Entertainment | Default | Customer User |
| `jordan.patel@acmelive.example.com` | Acme Live Entertainment | Default | Read Only |
| `sam.rivera@globexevents.example.com` | Globex Events | Default | Customer Admin |

Try the Customer Admin account first — it can access every screen, including Upload Data (Read Only cannot). Sign in as Sam Rivera (Globex Events) afterwards to see a different, smaller Data Product catalog — the two organizations are seeded with deliberately different entitlements on their default tenants (see [Authorization / Entitlements](#authorization--entitlements)) so cross-tenant isolation is something you can actually observe, not just take on faith.

## Docker Development

```bash
cp .env.example .env   # then set AUTH_SECRET, same as above
docker compose up --build
```

The portal is available at [http://localhost:3000](http://localhost:3000). This starts a single application container — no database, cache, or message broker is needed for Phase 1.

The image is a multi-stage build (`dependencies` → `builder` → `runner`) that produces a minimal Next.js `standalone` output, runs as a non-root user, and exposes a container `HEALTHCHECK` against `/api/health`.

## Production Build

```bash
npm run build
npm start
```

Note: `npm start` (`next start`) works for local verification, but since `next.config.ts` sets `output: "standalone"` for the Docker image, the container itself runs `node server.js` against the standalone build output rather than `next start` — see the `Dockerfile`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Secret used by Auth.js to sign session tokens. **Required.** Generate with `npx auth secret`. Never commit a real value. |
| `NEXTAUTH_URL` | Canonical URL of the app (`http://localhost:3091` in Docker, `http://localhost:3000` for `next dev`). |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | OAuth client credentials from Google Cloud Console (APIs & Services > Credentials). Authorized redirect URI: `<NEXTAUTH_URL>/api/auth/callback/google`. Leave blank to disable Google sign-in; Credentials login keeps working either way. |
| `NEXT_PUBLIC_APP_NAME` | Display name shown in the UI (defaults to "Data Exchange"). |
| `NEXT_PUBLIC_API_BASE_URL` | Base URL the HTTP services (`src/services/http/*`, used by `clientServices`) call. Defaults to `""` (same-origin — this app's own `/api/*` route handlers); only set this if a separate middle-tier API ever replaces them. |
| `NEXT_PUBLIC_USE_MOCK_SERVICES` | `true` (default) uses in-memory mock services for `clientServices` (the `"use client"`-safe registry); `false` switches it to the HTTP implementations, which call this app's own `/api/*` routes. Server Components/route handlers (`services`) are always real, regardless of this flag. |
| `MONGODB_URI` | MongoDB connection string backing the tenant/user directory and the Organization/Tenant/Entitlement/DataProduct/Dataset catalog (see Authentication and Authorization / Entitlements below). |
| `MONGO_DATABASE` | Database name used on that connection (defaults to `portal`). |
| `MONGO_ROOT_USER` / `MONGO_ROOT_PASS` | Root credentials for the dockerized MongoDB instance (`docker-compose.yml`). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP credentials used to send verification and password-reset emails (`src/lib/mailer.ts`). Leave `SMTP_HOST` blank to log emails to the server console instead — the signup/verify/reset flows work fully without real SMTP. |

`.env.example` documents these; `.env.local` (dev) and `.env` (docker compose) are both git-ignored.

## Authentication

Auth.js (NextAuth v5) is configured with two providers in `src/auth.ts` — the *only* file that knows how a user is authenticated:

- **Credentials** — email + password, hashed with bcrypt per account.
- **Google** — OAuth sign-in.

Both providers resolve identity against the same **tenant directory**, a MongoDB `users` collection (`src/lib/user-directory.ts`) containing `{ email, name, organizationId, tenantId, role, passwordHash, emailVerified, createdAt, updatedAt }` per account.

### Signup, onboarding, verification, and password recovery

- **Signup** (`/signup`) only creates the account itself — email + password (`src/app/(auth)/signup/actions.ts`) or "Sign up with Google" — with no organization or tenant assigned yet (`organizationId`/`tenantId`/`role` all `null`). A first-time Google sign-in is treated the same way, minus the verification step, since Google has already confirmed the email.
- **Onboarding** (`/onboarding`, `src/app/(auth)/onboarding/`) is a post-login gate: any signed-in user without an organization is routed here before they can reach the portal. They either:
  - search for and request to join an existing organization — the request is `PENDING` until a `CUSTOMER_ADMIN` of that org approves or rejects it from Settings (`/onboarding/pending` shows the wait state), or
  - create a brand-new organization, which also provisions its default `Tenant` and makes the creator its `CUSTOMER_ADMIN` immediately.

  An org admin can create additional tenants for their organization later, from Settings.
- **Email verification** is mandatory for Credentials accounts: a signup can't sign in until it follows the link emailed to it (`src/lib/auth-tokens.ts` issues a single-use, expiring, hashed token; `/verify-email` consumes it). The Credentials provider's `authorize()` throws a typed `email-not-verified` error for an unverified account, which `login-form.tsx` turns into a "resend verification email" prompt (`/check-email`).
- **Forgot / reset password** (`/forgot-password`, `/reset-password`) follows the same token mechanism with a 1-hour expiry. `/forgot-password` always returns the same generic message regardless of whether the email exists or has a password, so it can't be used to enumerate accounts.

Demo/seed accounts (`npm run seed:users`, upserting `src/data/mocks/users.ts`) are pre-verified, pre-onboarded, and share the password `portal-demo`, stored as a real bcrypt hash like any other account — they exercise the same login path as a real signup, not a special case.

- Unauthenticated requests to any portal or onboarding route are redirected to `/login`, enforced both at the edge (`src/proxy.ts`) and again server-side (`requireTenantContext()` for `(portal)` pages).
- Authenticated users visiting `/` are redirected to `/dashboard`, which then redirects to `/onboarding` if they have no organization/tenant yet.
- The session carries `userId`, `organizationId`, `tenantId`, and `role` (all but `userId` nullable pre-onboarding) — enough for every page and service call to establish tenant and permission context without further lookups. Sessions themselves are JWT-based, not database-persisted — Auth.js doesn't support database sessions alongside a Credentials provider. The `jwt` callback lazily re-fetches the user by id whenever `organizationId` is still `null`, so finishing onboarding (or having a join request approved) takes effect on the very next page load, no re-login required.

**Migrating to a real identity provider** (Microsoft Entra ID, Okta, Auth0, or a customer's own SSO) means adding a provider to `src/auth.ts` and mapping its profile to `{ id, name, email, organizationId, tenantId, role }` via the same tenant directory lookup. Nothing else in the app changes, because routes, services, and components only ever read identity from the session — never from the provider directly.

## Authorization / Entitlements

Authentication answers "who is this?" Authorization answers "what can they see?" — that's a six-layer chain, enforced in this order every time:

```text
User → Organization → Tenant → Entitlement → Data Product → Dataset (+ row-level policy)
```

- **User → Organization → Tenant**: established once, at sign-in, by `requireTenantContext()` (`src/lib/tenant.ts`) — see Authentication above. Organization is the membership/admin unit (who can join, who can approve, who can create tenants); Tenant is the actual data-scoping unit everything below is enforced against.
- **Tenant → Entitlement → Data Product**: `entitlements` is a real MongoDB collection (not a mock) — the join row that says "this tenant may see that Data Product." It's the one collection in this chain that's genuinely tenant-owned data, so it's the one collection accessed exclusively through `TenantScopedCollection` (`src/lib/tenant-scoped-collection.ts`): every read/write is constructed with a fixed `tenantId`, and a filter or document naming a *different* tenantId is rejected with a `TenantIsolationError` instead of silently ignored — a forgotten or wrong tenant check fails loudly, it can't silently widen access. `entitlements` also has a `$jsonSchema` validator requiring `tenantId`/`dataProductId`/`status` on every document, so MongoDB itself rejects a write missing its tenant, independent of any application code path.
- **Data Product → Dataset**: `dataProducts` and `datasets` are shared catalog collections (not tenant-owned — the same document is valid for every tenant entitled to it). `src/services/mongo/mongo-dataset-service.ts` and `mongo-data-product-service.ts` are the only things that join catalog content to entitlements: a dataset or data product a tenant isn't entitled to comes back as `null`, the same not-found shape used for an id that doesn't exist at all — so guessing another tenant's exact id confirms nothing.
- **Dataset → row-level policy**: each `Dataset` carries a `rowLevelPolicy` (`{ tenantColumn, description }`) documenting which column in the underlying data is enforced against the caller's tenant once actual rows are queried — always bound to the session-derived tenant, structurally never a value a caller can supply.

`organizations`, `tenants`, `organizationMembershipRequests`, `dataProducts`, `datasets`, `entitlements`, `apiAccess`, `exchanges`, `downloads`, `uploads`, and `notifications` are all wired to their Mongo-backed service implementations (`src/services/mongo/`) unconditionally in `src/services/index.ts` (the `services` registry, used by Server Components and route handlers) — the same treatment `user-directory.ts` gets for identity. `NEXT_PUBLIC_USE_MOCK_SERVICES` now only governs `clientServices` (`src/services/client.ts`, used by `"use client"` components) — Mongo can't ship to a browser bundle, so the interactive parts of Uploads/Downloads/Notifications (submitting a file, requesting a download link, marking a notification read) still go through the mock/HTTP toggle client-side, hitting real `/api/*` route handlers once the flag is `false`. See [Service Architecture](#service-architecture) below.

Seed the catalog (two demo organizations, each with one default tenant, with different entitlements) after seeding users:

```bash
npm run seed:catalog   # upserts organizations, tenants, dataProducts, datasets, and entitlements into MongoDB
```

## Service Architecture

Every domain capability (`Organization`, `Tenant`, `OrganizationMembership`, `DataProduct`, `Dataset`, `Entitlement`, `Exchange`, `Upload`, `Download`, `Notification`, `ApiAccess`) is defined as a TypeScript interface in `src/services/interfaces/`, with:

- a **Mongo-backed implementation** in `src/services/mongo/` for every capability — this is what backs the `services` registry (`src/services/index.ts`), used by Server Components and route handlers, unconditionally regardless of `NEXT_PUBLIC_USE_MOCK_SERVICES` (see Authorization / Entitlements above)
- a **mock implementation** in `src/services/mocks/` — in-memory, deterministic, backed by fixture data in `src/data/mocks/`
- an **HTTP implementation** in `src/services/http/` — `fetch`/`XMLHttpRequest` wrappers calling this same app's own `/api/*` route handlers (`src/app/api/uploads`, `/api/downloads/*`, `/api/notifications/*`), which in turn call the real Mongo-backed `services` registry — there is no separate middle-tier service in this repo's deployment

The mock and HTTP implementations back a second, smaller registry: `clientServices` (`src/services/client.ts`), the one `"use client"` components are allowed to import, since Mongo can't ship to a browser bundle. `src/services/client.ts`'s `createClientServices()` is the single factory that decides mock vs HTTP for that registry based on `NEXT_PUBLIC_USE_MOCK_SERVICES`; components import `clientServices`/`services` and are never aware of `Mock*`/`Http*`/`Mongo*` classes directly.

Every service method scoped by tenant takes `tenantId` as its first argument, and every implementation — mock or Mongo — enforces it: requests for a tenant ID that isn't recognized, or isn't entitled to a given resource, return empty results or `null` rather than the full catalog. The HTTP implementations never send `tenantId` over the wire at all — every `/api/*` route handler derives it exclusively from the session via `requireApiTenantContext()` (`src/lib/api-auth.ts`), the same rule `requireTenantContext()` enforces for pages.

## Future Integration

Uploads/Downloads/Exchanges/Notifications are real today — backed by MongoDB (including GridFS for file bytes; see `src/lib/file-storage.ts`) and this app's own `/api/*` route handlers, with `NEXT_PUBLIC_USE_MOCK_SERVICES=false` switching `clientServices` over to call them. What's still genuinely out of scope, per [Overview](#overview): the actual Bronze -> Silver -> Gold lakehouse, a real data-transform pipeline (an upload's "processed output" is currently the same file echoed back — see the doc comment in `src/services/mongo/mongo-upload-service.ts`), and a separate middle-tier service distinct from this app.

To connect this portal to that eventually:

1. Stand up the real middle tier and Data Product Services described in [Overview](#overview).
2. Point `NEXT_PUBLIC_API_BASE_URL` at it instead of the same-origin default, and adjust `src/services/http/*` paths/auth if its API shape differs from this app's own `/api/*` routes.
3. Replace `src/services/mongo/mongo-upload-service.ts`'s echo-back logic with a real call into that pipeline.
4. Replace the Credentials provider in `src/auth.ts` with the organization's real identity provider.

No component or page should need to change for this migration — that separation is the point of the service-interface layer.

## Testing

Tests use [Vitest](https://vitest.dev/) + React Testing Library.

```bash
npm test          # run once
npm run test:watch
```

Coverage is intentionally a foundation, not exhaustive: it checks that route protection resolves tenant identity correctly (never from caller input), that the `Dataset` and `Exchange` mock services enforce tenant scoping, that a representative UI component (`StatusBadge`) renders correctly, and that a representative feature workflow (dataset search/filtering) behaves as expected. Extend `src/**/__tests__/` alongside new features rather than centralizing tests elsewhere.

## Security Notes (Phase 1)

- Tenant identity is derived exclusively from the authenticated session (`requireTenantContext()`), never accepted from route params or query strings.
- The `entitlements` collection — the record of which Data Products a tenant may see — is only ever accessed through `TenantScopedCollection` (`src/lib/tenant-scoped-collection.ts`), which rejects any read or write naming a different tenantId instead of silently overriding it, and carries a `$jsonSchema` validator requiring `tenantId` at the database layer. See Authorization / Entitlements above.
- Joining an organization requires admin approval — a search match alone doesn't grant access; a `CUSTOMER_ADMIN` of that org must approve the pending `OrganizationMembershipRequest` first (`src/app/(portal)/settings/membership-actions.ts`).
- Route protection is enforced both at the edge (`src/proxy.ts`) and per-page (server components), not just client-side.
- Mock API credentials shown on the API Access page are masked and fabricated — no real secrets exist in this codebase.
- Session tokens are managed by Auth.js's HttpOnly cookies; nothing touches `localStorage`.
- The production Docker image runs as a non-root user (`nextjs`, uid 1001).
- Uploads are validated by file extension and size on the client, and re-validated server-side in `src/app/api/uploads/route.ts` (never trust client-side checks alone) before being persisted. File bytes are stored in MongoDB GridFS (`src/lib/file-storage.ts`) — not local disk, which the `portal` container doesn't persist across rebuilds (see `docker-compose.yml`). GridFS has no isolation of its own; every reader resolves a storage id through a tenant-scoped lookup first. Download links are short-lived, single-file-bound tokens (`src/lib/download-tokens.ts`), not permanent URLs.

## Project Structure

```text
src/
├── app/                  # Next.js App Router routes
│   ├── (auth)/           # Public login, signup, onboarding, check-email, verify-email, forgot/reset-password pages
│   ├── (portal)/         # Authenticated portal shell + all feature pages
│   └── api/              # /api/auth, /api/health, /api/uploads, /api/downloads/*, /api/notifications/*
├── auth.ts               # Auth.js configuration (the only place identity is established)
├── proxy.ts              # Edge-level route protection
├── components/           # ui/, layout/, navigation/, dashboard/, datasets/, exchanges/, upload/
├── services/             # interfaces/, mocks/, http/, mongo/, and the services factory
├── models/               # Domain types (Organization, Tenant, OrganizationMembershipRequest, Entitlement, DataProduct, Dataset, Exchange, etc.)
├── lib/                  # tenant.ts, tenant-scoped-collection.ts, *-directory.ts, authorization.ts, formatting/validation helpers
├── config/                # env.ts, app.ts, navigation.ts
└── data/mocks/           # Deterministic fixture data
```
