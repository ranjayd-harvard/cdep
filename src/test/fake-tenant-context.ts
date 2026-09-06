import { UserRole } from "@/models";
import type { TenantContext } from "@/lib/tenant";

/**
 * Builds a minimal, valid `TenantContext` from just a tenant id, for
 * tests that only care about tenant-scoping and don't exercise
 * `organizationId`/`role`-dependent behavior (e.g. `MongoExchangeService`,
 * which only ever reads `.tenantId` off the context it's given).
 */
export function fakeTenantContext(tenantId: string, overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    userId: `user-${tenantId}`,
    organizationId: `org-${tenantId}`,
    tenantId,
    role: UserRole.CUSTOMER_ADMIN,
    name: "Test User",
    email: "test@example.com",
    ...overrides,
  };
}
