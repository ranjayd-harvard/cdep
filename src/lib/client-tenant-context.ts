import type { Session } from "next-auth";
import type { TenantContext } from "@/lib/tenant";

/**
 * Client-side analog of `requireTenantContext()`/`requireApiTenantContext()`
 * (`src/lib/tenant.ts`, `src/lib/api-auth.ts`) for the handful of "use
 * client" components that call a `ClientServiceRegistry` method taking a
 * full `TenantContext` (see `src/services/interfaces`). Those two
 * server-side helpers redirect/403 on an incomplete session; this one
 * just returns `null` so the caller can no-op — a client component has
 * no response to send, only a button to disable.
 */
export function toTenantContext(user: Session["user"] | undefined): TenantContext | null {
  if (!user?.tenantId || !user.organizationId || !user.role) return null;
  return {
    userId: user.id,
    organizationId: user.organizationId,
    tenantId: user.tenantId,
    role: user.role,
    name: user.name ?? "",
    email: user.email ?? "",
  };
}
