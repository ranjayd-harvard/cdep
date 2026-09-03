import { auth } from "@/auth";
import { UserRole } from "@/models";
import type { TenantContext } from "@/lib/tenant";

export type ApiTenantResult = { ok: true; tenant: TenantContext } | { ok: false; status: 401 | 403 };

/**
 * The Route Handler equivalent of `requireTenantContext()` (`src/lib/tenant.ts`).
 * That function calls `redirect()`, which only works from a Server
 * Component/Action — a Route Handler must respond with a status code
 * instead, so this mirrors the same auth/org/tenant/role resolution but
 * returns a discriminated result for the caller to turn into a
 * `NextResponse`.
 *
 * `src/proxy.ts`'s matcher only covers page routes, not `/api/*`, so
 * every Route Handler must call this itself rather than assuming Proxy
 * already checked the request.
 */
export async function requireApiTenantContext(): Promise<ApiTenantResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, status: 401 };
  }

  if (
    session.user.role === UserRole.SUPERUSER ||
    !session.user.organizationId ||
    !session.user.tenantId ||
    !session.user.role
  ) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    tenant: {
      userId: session.user.id,
      organizationId: session.user.organizationId,
      tenantId: session.user.tenantId,
      role: session.user.role,
      name: session.user.name ?? "",
      email: session.user.email ?? "",
    },
  };
}
