import type { TenantContext } from "@/lib/tenant";

/**
 * Mints the bearer token data-exchange-service's `AUTH_MODE=development`
 * auth middleware accepts: a base64url JSON payload shaped like the real
 * JWT claims it will eventually verify (`{sub, organization_id,
 * active_tenant_id, role}`), NOT a signed token — the service decodes it
 * without verifying a signature.
 *
 * This is a deliberate, documented interim bridge, not a security
 * boundary of its own: it works only because data-exchange-service
 * refuses to boot with `AUTH_MODE=development` when `NODE_ENV=production`
 * (see that service's `src/config/env.ts`), so this path cannot
 * accidentally reach a production deployment. It must be replaced before
 * either service ships to production — see
 * `docs/exchange-service-integration.md` § "Auth bridge (dev-only)" for
 * the real-OIDC plan.
 *
 * `TenantContext.role` is guaranteed to be CUSTOMER_ADMIN/CUSTOMER_USER/
 * CUSTOMER_READONLY here (never SUPERUSER, never null) because every
 * caller obtains it from `requireTenantContext()` / `requireApiTenantContext()`,
 * both of which reject superusers and incomplete-onboarding sessions
 * before a `TenantContext` is ever constructed. Those three role names
 * are also spelled identically in data-exchange-service's role set
 * (`CUSTOMER_ADMIN`/`CUSTOMER_USER`/`CUSTOMER_READONLY`), so no role
 * mapping table is needed — see the same doc, § "Role mapping".
 */
export function mintDevToken(context: TenantContext): string {
  const payload = {
    sub: context.userId,
    organization_id: context.organizationId,
    active_tenant_id: context.tenantId,
    role: context.role,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
