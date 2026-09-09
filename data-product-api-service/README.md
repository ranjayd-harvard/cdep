# data-product-api-service

Phase 8 Data Product API Delivery Layer: the customer-facing, tenant-isolated,
cursor-paginated query surface over the API Serving Store. Reuses Catalog
(contract resolution), Subscription (entitlement + version resolution), and
the same Fastify/auth/error-model conventions as `subscription-service` and
`scheduling-service`.

```
GET /v1/data-products/event-performance/events
```

## Request sequence (spec §8.6/§8.7)

Authenticate → resolve org/tenant from the token → entitlement check
(subscription-service) → API-delivery-permission + active-subscription +
version resolution (subscription-service) → Catalog contract resolution
(data-product-catalog-service) → allowlisted query validation → cursor
decode → tenant-scoped serving-store query → contract-driven response
projection → cursor-paginated response.

Every one of those steps runs on every request — nothing is cached across
requests except the (stateless) contract-policy computation itself.

## Local development

```bash
npm install
cp .env.example .env   # points at localhost:8092/8093/5440 already
npm run dev
npm run test
```

Requires `data-product-catalog-service`, `subscription-service`, and
`serving-projection-service`'s Postgres (host port 5440, migrated + seeded)
already running — see the root `docker-compose.yml` comments and
`serving-projection-service/README.md`.

## Docker

```bash
docker compose up -d --build
curl http://localhost:8095/health/live
```

No Postgres of its own — see `docker-compose.yml`'s comment on why it reads
`serving-projection-service`'s Postgres directly.

## Demo (spec §8.17/§8.18/§8.19)

```bash
npm run demo
```

Grants entitlement + creates an API subscription (pinned to `1.0.0`) for
two fixture tenants, then proves: Tenant A/B isolation on the same
`event_id`, `?tenant_id=` query-param injection has no effect, internal
fields exist in the serving row but never in the response (and requesting
one via `?fields=` is rejected), and cursor pagination is deterministic and
rejects cross-tenant reuse.

## OpenAPI

```bash
npm run export-openapi   # writes openapi.json
```

Also served live at `/docs` (Swagger UI) and `/documentation/json`.

## Error model

```json
{ "error": { "code": "INVALID_FILTER", "message": "...", "request_id": "..." } }
```

See `src/common/errors/app-error.ts` for the full `ErrorCode` union and
HTTP status mapping (spec §8.10).

## Extending to a second resource/Data Product

Everything through the Catalog contract, entitlement/subscription
resolution, cursor design, and error model is already generic. What's
currently hard-coded to `event-performance`/`events` (deliberately, per
spec §8.2's vertical-slice scope) is:

- The route path in `src/api/customer/events.routes.ts`.
- `DATA_PRODUCT_ID`/`RESOURCE` constants in
  `src/application/services/event-performance-query.service.ts`.
- `PostgresServingStore`'s SQL (one query method, one serving table).

A second resource means a new route + a new `ServingStore` method against
its own serving table — the auth/entitlement/subscription/version/contract
machinery is reused as-is.
