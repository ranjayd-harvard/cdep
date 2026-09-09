# Data Product Catalog & Contract Registry

**Phase 5** of the platform. The runtime, database-backed authoritative
registry for Data Products, their versions, externally-published schemas,
contracts, SLA, quality, and delivery metadata.

```
CONTRACT AS CODE (Git)  →  CI validate/register  →  CATALOG (this service)  →  Portal / Publication Service / (future) Subscription Service
     authoring source                                  runtime system of record
```

Git remains the source of truth for how a Data Product contract is
*authored*. This service is the source of truth for what is *currently true
at runtime* — which products exist, which version is ACTIVE, what schema is
externally exposed, what SLA/quality/delivery apply. **Never reverse this
relationship**: there is no UI or API here for hand-editing a production
schema (see §14/§67 of the Phase 5 spec this service implements).

## Responsibility boundary

Owns: Data Product/Domain/Owner definitions, product versions, external
schemas, contract metadata + registration history, quality/SLA policy,
supported delivery methods, publication policy, lifecycle state, discovery.

Does **not** own: customer subscriptions/entitlements, scheduled
publication, file storage, Bronze/Silver/Gold data or transformations,
publication *execution*, exchange lifecycle, billing, or SLA *monitoring*
(the catalog stores declared policy; actual measurement lives in the
Lakehouse/observability systems and, later, Phase 9).

## Stack

Node 20+, TypeScript (strict), Fastify, PostgreSQL (schema `catalog`, plain
`pg` + hand-written SQL migrations — no ORM), Zod, `@fastify/swagger`, Pino,
Vitest, Docker. Ports: API `8092`, Postgres `5437` (both external-only —
`5433/5434/5436` and `8080/8090/8091` are already taken by
data-exchange-service / data-lakehouse / data-publication-service on this
machine).

## Running locally

```bash
docker compose up -d postgres
npm install
npm run migrate
npm run seed          # provisions the "events" domain + "event-analytics" owner
npm run dev            # http://localhost:8092, docs at /docs
```

Or the whole thing in Docker:

```bash
docker compose up --build
```

`AUTH_MODE=development` (the default) lets unauthenticated `/internal/v1/*`
requests through as a fixed `PLATFORM_ADMIN` dev actor, so the workflow
below works with plain `curl`. Production must set a real
`INTERNAL_API_TOKEN` and pass `x-internal-api-key` / `x-actor-type` /
`x-actor-id` / `x-actor-role` headers (`AUTH_MODE=development` is refused at
boot when `NODE_ENV=production`).

## Contract-as-Code workflow

```
edit contracts/gold/*.yaml  →  npm run contract:validate  →  npm run contract:register  →
  view via GET /v1/data-products/{id}  →  activate  →  query active version
```

```bash
npm run contract:validate -- contracts/examples/event-performance-v1.0.yaml
npm run contract:register -- contracts/examples/event-performance-v1.0.yaml
curl -s http://localhost:8092/v1/data-products/event-performance | jq
curl -s -X POST http://localhost:8092/internal/v1/data-products/event-performance/versions/1.0.0/activate
curl -s http://localhost:8092/internal/v1/data-products/event-performance/active-version | jq
```

`contracts/examples/` also contains the worked compatibility example from
the spec: `event-performance-v1.1.0.yaml` (additive nullable field →
`NON_BREAKING`, accepted as a minor bump), `event-performance-v1.2.0-invalid.yaml`
(removes `venue_id` but only bumps the minor version → rejected with
`BREAKING_CHANGE_REQUIRES_MAJOR_VERSION`), and `event-performance-v2.0.0.yaml`
(the same removal, correctly expressed as a major bump → accepted as
`BREAKING`).

## Database ERD (schema `catalog`)

```
domains ──┐
          │  1:N
owners ───┼──> data_products ──1:N──> data_product_versions ──1:N──> product_schema_fields
          │                                  │
          │                                  ├──1:1──> quality_policies
          │                                  ├──1:1──> sla_policies
          │                                  ├──1:N──> supported_delivery_methods
          │                                  ├──1:1──> publication_policies
          │                                  └──1:N──> contracts (append-only; latest REGISTERED is authoritative)
          │
          └──────────────────────> registration_events (append-only, FK to data_products)
```

At most one `ACTIVE` `data_product_version` per product is enforced by a
partial unique index (`product_versions_one_active_idx`), not just
application code — see `migrations/012_indexes.sql` and the note in
`004_product_versions.sql` on how Phase 6+ would lift this for parallel
major versions.

## API surface

`/v1/*` — customer-facing, read-only, no internal metadata (source repo,
commit, registrant, internal-only schema fields never appear):

- `GET /v1/data-products` — search/list (`search`, `domain`, `status`,
  `limit`, `cursor`)
- `GET /v1/data-products/{productId}`
- `GET /v1/data-products/{productId}/versions`
- `GET /v1/data-products/{productId}/versions/{version}`

`/internal/v1/*` — service-to-service, `x-internal-api-key` gated:

- `POST /internal/v1/contracts/register` — the Contract-as-Code entry point
- `GET /internal/v1/data-products/{productId}/versions/{version}/contract`
- `GET /internal/v1/data-products/{productId}/active-version`
- `POST /internal/v1/data-products/{productId}/versions/{version}/activate`
- `POST /internal/v1/data-products/{productId}/versions/{version}/deprecate`
- `POST /internal/v1/data-products/{productId}/versions/{version}/retire`
- `GET|POST /internal/v1/domains`, `GET|POST /internal/v1/owners` — reference
  data, provisioned ahead of registration (see "Registering a brand-new
  product" below)

`GET /health/live`, `GET /health/ready` (checks Postgres). Full OpenAPI at
`/docs` (Swagger UI) once the server is running.

## Registering a brand-new product

Registration validates that `spec.domain.id` and `spec.owner.id` already
exist — it does **not** silently create them. Provision them once via
`POST /internal/v1/domains` / `POST /internal/v1/owners` (or `npm run seed`
for the Event Performance example), then register the contract. This keeps
Domain/Owner as small, deliberately-managed reference data rather than
whatever a contract author happened to type.

## Compatibility engine (`src/registration/compatibility.ts`)

Deliberately explicit and small, not a general schema-registry framework:

| Change | Level |
|---|---|
| Add nullable/optional field | `NON_BREAKING` |
| Add a *required, customer-visible* field | `BREAKING` (existing producers won't supply it) |
| Remove a published field | `BREAKING` |
| Rename a field | `BREAKING` (modeled as remove + add-required) |
| Incompatible type change | `BREAKING` |
| Make an optional field required | `BREAKING` |
| Change grain-key or customer-visibility status | `BREAKING` |
| Description/documentation only | `METADATA_ONLY` |

Semantic version bump is then cross-checked against the detected level
(`registration.service.ts`): `BREAKING` requires a major bump, `NON_BREAKING`
requires at least a minor bump, `METADATA_ONLY` allows a patch bump. A
version number must always be strictly greater than the product's latest
registered version, breaking or not.

## Registering the same contract twice

Idempotent by design (spec §17): the same `data_product_id` + `version` +
canonical contract hash returns the original registration result
(`registration: "DUPLICATE"`) instead of erroring or duplicating rows. A
`CONTRACT_DUPLICATE_DETECTED` event is still recorded for the audit trail.
Registering the *same version* with *different* content is rejected
(`VERSION_ALREADY_EXISTS`) — a version's content is immutable once
registered; ship a new version instead.

## Auditability

Every registration/activation/deprecation/retirement writes an append-only
`catalog.registration_events` row (`registration.service.ts` /
`registration/lifecycle.service.ts` / `registration/registration-event.repository.ts`),
capturing actor, event type, and event-specific data (contract id/hash,
source repo/path/commit, compatibility decision, superseded/replacement
version). This answers every question in spec §36 without joining anything
beyond `catalog.contracts` + `catalog.registration_events`.

## Publication Service / Portal integration

Both are implemented and were exercised live against a running instance of
this service, not just documented:

- **Publication Service** (`data-publication-service`, Python/FastAPI):
  `src/publication/contracts/catalog_client.py` (`CatalogClient`) calls
  `GET /internal/v1/data-products/{id}/active-version` then
  `GET /internal/v1/data-products/{id}/versions/{version}/contract`.
  `src/publication/contracts/loader.py`'s `load_publication_contract()`
  overlays the Catalog-owned fields (schema, formats, filename pattern,
  expiration) onto the local YAML when `PUBLICATION_CONTRACT_SOURCE=catalog`;
  `source.table` / `tenantScope` / masking / the publication-time quality
  *gate* stay local either way, since those are physical Gold wiring the
  Catalog deliberately doesn't own (§33/§63 above). Default
  (`PUBLICATION_CONTRACT_SOURCE=local`) is byte-for-byte unchanged Phase 4
  behavior — see `data-publication-service/tests/unit/test_catalog_merge.py`.
- **Portal** (`src/lib/catalog-service/client.ts` in the repo root):
  `getCatalogProduct` / `listCatalogProducts` (`/v1/*`) and
  `getCatalogActiveVersion` (`/internal/v1/*`), gated by
  `CATALOG_SERVICE_URL` exactly like `LAKEHOUSE_SERVICE_URL` /
  `PUBLICATION_SERVICE_URL` already are in the root `docker-compose.yml`.
  Wiring a specific page (e.g. `/datasets/[datasetId]`) to call it is left
  to a follow-up — the repo had in-flight, unrelated admin-console work
  touching those exact dataset/data-product files at the time this was
  built, so the client was added additively without touching them. The
  portal never edits production contract/schema data through this client,
  only reads it.

## Running the tests

```bash
docker compose up -d postgres
npm run migrate
npm test
```

Integration tests run against a real Postgres (matching this repo's sibling
services) — they are not mocked. Each integration test suite creates its
own randomly-suffixed domain/owner/product so the suite can be re-run
without resetting the database between runs.

## Assumptions & known limitations

- Domain/Owner are pre-provisioned reference data; registration validates
  but never auto-creates them (spec's §15 "validate domain/owner" read
  literally, rather than §58's looser phrasing).
- One canonical `ACTIVE` version per product (Phase 5 scope, per spec §10);
  parallel major-version tracks are a documented Phase 6+ extension.
- `ProductVisibilityResolver` (`src/modules/discovery/`) is a local
  stub — every discoverable + ACTIVE product is visible to every caller.
  Swapping in real entitlement-aware visibility is Phase 6/10's job; routes
  already call through the interface rather than checking `discoverable`
  inline.
- No SLA/quality *monitoring*, no delivery *execution*, no
  subscription/billing — all deliberately out of scope (spec §68).
- `contract_format` on `/internal/v1/contracts/register` defaults to
  `YAML` when unspecified, since that's the primary authoring format; the
  CLI always sets it from the file extension.

## Recommended Phase 6

Subscription Service: `product_id` + `requested_version` + `delivery_method`,
resolving against this catalog's `GET /v1/data-products/{id}/versions` +
`GET /internal/v1/data-products/{id}/versions/{version}/contract` for
validation, and a real `ProductVisibilityResolver` backed by tenant
entitlements instead of the local stub.
