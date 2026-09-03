"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext, type TenantContext } from "@/lib/tenant";
import { canManageSettings } from "@/lib/authorization";
import { services } from "@/services";
import { assignPortalUserToOrganization } from "@/lib/user-directory";
import { UserRole } from "@/models";

async function requireOrgAdmin(): Promise<TenantContext> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    throw new Error("Only an organization admin can manage membership requests.");
  }
  return tenant;
}

/**
 * Approves a pending request to join the caller's organization: assigns
 * the requester to the org's default tenant as CUSTOMER_USER (an admin
 * can change their role afterward from this same page). The requester's
 * own session picks this up on their next page load via the `jwt`
 * callback's lazy-refresh branch in `src/auth.ts` — no re-login needed.
 */
export async function approveMembershipRequest(requestId: string): Promise<void> {
  const tenant = await requireOrgAdmin();

  const pending = await services.organizationMemberships.listPendingRequests(tenant.organizationId);
  const request = pending.find((item) => item.id === requestId);
  if (!request) {
    // Already resolved, or belongs to a different org — nothing to do.
    return;
  }

  const defaultTenant = await services.tenants.getDefaultTenant(tenant.organizationId);
  if (!defaultTenant) {
    throw new Error(`Organization "${tenant.organizationId}" has no default tenant.`);
  }

  await assignPortalUserToOrganization(request.userId, {
    organizationId: tenant.organizationId,
    tenantId: defaultTenant.id,
    role: UserRole.CUSTOMER_USER,
  });
  await services.organizationMemberships.approveRequest(requestId, tenant.userId);

  revalidatePath("/settings");
}

export async function rejectMembershipRequest(requestId: string): Promise<void> {
  const tenant = await requireOrgAdmin();

  const pending = await services.organizationMemberships.listPendingRequests(tenant.organizationId);
  const belongsToOrg = pending.some((item) => item.id === requestId);
  if (!belongsToOrg) {
    return;
  }

  await services.organizationMemberships.rejectRequest(requestId, tenant.userId);
  revalidatePath("/settings");
}
