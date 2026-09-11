# Tenant Isolation

## Primary control: application-layer tenant filtering (enforced today)

This is the platform's real, load-bearing tenant-isolation control, and it predates Phase 11. It works like this in every service (`data-exchange-service`, `subscription-service`, `scheduling-service`, `data-platform-observability-service`, `data-product-api-service`):

- Customer-facing routes derive `organizationId`/`activeTenantId` only from the authenticated `SecurityContext` (now backed by real JWT verification, see [identity.md](identity.md)) — never from query params, path params, or request bodies.
- Tenant-owned repository functions take `organizationId`/`tenantId` as **mandatory, non-optional, leading parameters** (`data-exchange-service`'s `exchange.repository.ts`, `subscription-service`'s `subscription.repository.ts`, `data-product-api-service`'s `postgres-serving-store.ts` — the last of which additionally resolves every dynamic sort/filter field through a fixed allowlist map, so no request-controlled value is ever concatenated into SQL).
- Phase 11 fixed the one weak spot the inventory found: `scheduling-service`'s `findExecutionById` was reachable from a customer route with no SQL-level tenant predicate, relying on an app-layer post-fetch equality check instead. It now has a WHERE-filtered `findExecutionByIdForTenant`, matching the stronger pattern everywhere else (see `scheduling-service/src/api/customer/subscription-schedule.routes.ts`).
- Cross-tenant existence is never confirmed: a resource belonging to another tenant returns the same 404 a genuinely nonexistent one would (`data-product-api-service`'s Phase 8 anti-enumeration discipline, mirrored elsewhere).

This is tested today by `data-product-api-service/src/tests/e2e/phase8-tenant-isolation.test.ts` and the per-service repository integration tests.

## Secondary control: PostgreSQL Row Level Security — status

Per the spec's defense-in-depth requirement, RLS is meant to back up (not replace) the application predicate above. Current state, honestly:

- **RLS policies exist** on `exchange.exchanges` and `exchange.pipeline_jobs` (`data-exchange-service/migrations/004_exchanges.sql`, `009_pipeline_jobs.sql`), reading `current_setting('app.organization_id')`/`current_setting('app.tenant_id')`.
- **Phase 11 added distinct, least-privilege application roles** — `app_exchange` (`data-exchange-service/migrations/010_least_privilege_role.sql`) and `app_subscription` (`subscription-service/migrations/009_least_privilege_role.sql`) — granted only the specific SELECT/INSERT/UPDATE privileges each service's code path needs, separate from the migration/owner role. Both migrations were applied and verified against the running local databases. Because these roles do **not** own the tables, RLS applies to them automatically the moment the application connects as one — no `FORCE ROW LEVEL SECURITY` is needed for a non-owner role (FORCE only matters for the table owner/superuser bypass case).
- **The running application does not yet connect as these roles.** Doing so safely requires per-request `SET LOCAL app.organization_id/app.tenant_id` scoping (RLS session GUCs are transaction-scoped, so every tenant-owned query in a request must run inside the same checked-out connection that set them), which in turn requires auditing every call site that touches `exchanges`/`pipeline_jobs` to make sure none of them silently fall back to a different, unscoped connection — a query that did would return **zero rows** under enforced RLS (fails closed), which is safe but would look like a bug, not a security hole, if the audit missed a call site. Given the size of that audit (this table alone is touched by upload, download, listing, pipeline-worker, and catalog-sync code paths), we did not flip the live connection in this pass rather than ship a partially-wired enforcement path that could create a false sense of coverage.

**What this means concretely**: RLS is prepared infrastructure, not yet a load-bearing control, exactly as data-exchange-service's own migration comments already said before Phase 11 — Phase 11 moved it one step closer (real non-owner roles now exist and are granted correctly) without flipping the switch until the full per-request wiring can be done and tested as one coherent unit, service by service. The application-layer predicate above remains the platform's actual tenant-isolation guarantee today.

## Tracked follow-up (not yet done)

1. Add a second connection pool per service using the new least-privilege role, plus a `withTenantScopedClient(ctx, fn)` helper that checks out a client, runs `SET LOCAL app.organization_id/app.tenant_id` from the verified `SecurityContext`, and passes that client through to every repository call touching an RLS-protected table for the duration of one request.
2. Audit every call site touching `exchange.exchanges`/`exchange.pipeline_jobs` (and, once policies are added, every other tenant-owned table) to confirm 100% of them go through the scoped client — partial coverage is explicitly called out above as worse than no coverage, since it can look like protection that isn't actually there for the missed call sites.
3. Repeat the least-privilege-role migration for `scheduling-service`, `data-platform-observability-service`, `data-lakehouse`, `data-publication-service`, `serving-projection-service`, and extend RLS policies to their tenant-owned tables (see the summary table in [phase11-inventory.md](phase11-inventory.md)).
4. Add the cross-tenant repository test proving the low-privilege role, with session GUCs set for Tenant A, returns zero rows for Tenant B — this becomes part of the mandatory release-gate test suite (spec §39/§40) once (1)-(3) land.
