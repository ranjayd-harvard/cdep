# Authorization

## Model

```text
Principal (SecurityContext: userId, organizationId, activeTenantId, roles[])
   +
Permission (e.g. "subscription.manage", "product.read", "catalog.manage")
   +
Resource (implicit — the tenant-scoped row/route being acted on)
        ↓
AuthorizationDecision { decision: ALLOW|DENY, resource, tenantId, policyVersion, reasonCode }
```

Every backend TS service has `src/auth/authorization.ts` with the same shape: a `Permission` union specific to that service, a `PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]>` matrix, `hasPermission()`, `requirePermission()` (a Fastify preHandler), and `authorize()` (builds the non-leaky decision record used in audit payloads). This is a mirrored pattern across services (no shared npm package — see the Phase 11 plan's architectural note), not six independent designs.

Customer routes use `requirePermission("x.y")`, never `if (ctx.role === "ADMIN")`. Internal/service-to-service routes additionally require a signed service-identity token (see [service-identities.md](service-identities.md)) or, for services not yet migrated, a minimum role via `requireInternalAuth(minimumRole)`.

## Role vocabulary

Every service's `Role` union now includes the full spec §9 canonical set (`CUSTOMER_USER`, `CUSTOMER_ADMIN`, `PRODUCT_CONSUMER`, `PRODUCT_OWNER`, `DATA_STEWARD`, `PLATFORM_OPERATOR`, `SECURITY_ADMIN`, `PLATFORM_ADMIN`, `SERVICE`) **added to**, not replacing, each service's pre-existing roles (e.g. `data-exchange-service` keeps `CUSTOMER_READONLY`/`SERVICE_ACCOUNT`, `data-product-catalog-service` keeps `CATALOG_READER`/`CONTRACT_REGISTRAR`/`PRODUCT_ADMIN`). This was a deliberate choice: unifying every service onto one identical role list would have meant renaming roles referenced in dozens of existing tests and internal-role gates for a purely cosmetic consistency gain, whereas *adding* the canonical roles achieves the actual goal — a Keycloak-issued token carrying `PRODUCT_OWNER` or `DATA_STEWARD` is recognized everywhere — without that churn.

## Permission matrices (representative)

| Service | Permissions |
|---|---|
| `data-exchange-service` | `upload`, `download`, `view_history`, `manage_tenant_config` (pre-existing) |
| `subscription-service` | `subscription.read`, `subscription.manage` |
| `scheduling-service` | `operations.read`, `publication.trigger` |
| `data-platform-observability-service` | `operations.read` |
| `data-product-api-service` | `product.read` |
| `data-product-catalog-service` | `catalog.read`, `catalog.manage`, `governance.read`, `governance.manage` |

## Non-leaky errors

`AuthorizationDecision` objects are built for the audit trail and are never returned to the customer verbatim — every denial collapses to a generic `FORBIDDEN`/`PRODUCT_NOT_FOUND` (the latter in `data-product-api-service`, which deliberately can't distinguish "doesn't exist" from "not entitled" from "wrong role" in its customer-facing responses, an anti-enumeration discipline that predates Phase 11 and that the new `requirePermission()` calls were built to preserve, not weaken).
