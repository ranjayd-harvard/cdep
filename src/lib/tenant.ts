import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UserRole } from "@/models";

export interface TenantContext {
  userId: string;
  organizationId: string;
  tenantId: string;
  role: UserRole;
  name: string;
  email: string;
}

/**
 * The single, authoritative way to learn "who is asking and for which
 * tenant" anywhere in the portal.
 *
 * Authenticated User -> Organization -> Tenant -> Entitlements -> Data Products
 *
 * Every (portal) page calls this instead of reading a tenantId from a
 * route param, query string, or form field. Route segments like
 * `/datasets/[datasetId]` only ever identify the *resource*; the tenant
 * performing the request always comes from the session established by
 * `src/auth.ts`. That keeps arbitrary cross-tenant access impossible by
 * construction, even before real database-level isolation exists.
 *
 * A signed-in user who hasn't finished onboarding yet (no organization or
 * tenant assigned — see `src/app/(auth)/onboarding`) is redirected there
 * rather than into the portal. Past that guard, both fields are narrowed
 * to non-null, so nothing downstream has to handle the org-less case.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // A superuser's organizationId/tenantId are permanently null (they're
  // platform-root, not scoped to a customer) — that's not the "hasn't
  // finished onboarding" case every other role hits below, so route them
  // to the Admin Console instead of `/onboarding`.
  if (session.user.role === UserRole.SUPERUSER) {
    redirect("/admin");
  }

  if (!session.user.organizationId || !session.user.tenantId || !session.user.role) {
    redirect("/onboarding");
  }

  return {
    userId: session.user.id,
    organizationId: session.user.organizationId,
    tenantId: session.user.tenantId,
    role: session.user.role,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
  };
}
