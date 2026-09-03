"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/lib/tenant";
import { canManageSettings } from "@/lib/authorization";
import { listPortalUsersByOrganization, updateUserTenant } from "@/lib/user-directory";
import { services } from "@/services";

/**
 * Admin-only: moves a different member of the caller's organization to a
 * different tenant within that same org. Defensive lookups mirror
 * `membership-actions.ts` — both the member and the target tenant must
 * actually belong to the caller's organization, never trusted from the
 * form alone.
 */
export async function reassignMemberTenant(userId: string, formData: FormData): Promise<void> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    throw new Error("Only an organization admin can reassign a member's tenant.");
  }

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (!tenantId) {
    return;
  }

  const [members, orgTenants] = await Promise.all([
    listPortalUsersByOrganization(tenant.organizationId),
    services.tenants.listTenants(tenant.organizationId),
  ]);

  const targetMember = members.find((member) => member.id === userId);
  const targetTenant = orgTenants.find((t) => t.id === tenantId);
  if (!targetMember || !targetTenant || targetMember.tenantId === tenantId) {
    return;
  }

  await updateUserTenant(userId, tenantId);
  revalidatePath("/settings");
}
