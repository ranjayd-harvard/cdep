import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UserRole } from "@/models";

export interface AdminContext {
  userId: string;
  name: string;
  email: string;
}

/**
 * The Admin Console's equivalent of `requireTenantContext` (see
 * `src/lib/tenant.ts`) — the single, authoritative way to learn "who is
 * asking" for every page/action under `/admin`. A superuser has no
 * organization/tenant to narrow into, so this returns identity only.
 */
export async function requireSuperuserContext(): Promise<AdminContext> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== UserRole.SUPERUSER) {
    // A non-superuser hitting /admin directly bounces to their normal
    // portal, which re-gates itself via requireTenantContext (onboarding,
    // login, etc.) — no need to duplicate that logic here.
    redirect("/dashboard");
  }

  return {
    userId: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
  };
}

export type ApiAdminResult = { ok: true; admin: AdminContext } | { ok: false; status: 401 | 403 };

/**
 * The Route Handler equivalent of `requireSuperuserContext()` — mirrors
 * `requireApiTenantContext` (`src/lib/api-auth.ts`): a Route Handler can't
 * `redirect()` a `fetch()` caller usefully, so this returns a discriminated
 * result for the caller to turn into a `NextResponse` instead.
 */
export async function requireApiSuperuserContext(): Promise<ApiAdminResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, status: 401 };
  }

  if (session.user.role !== UserRole.SUPERUSER) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    admin: {
      userId: session.user.id,
      name: session.user.name ?? "",
      email: session.user.email ?? "",
    },
  };
}
