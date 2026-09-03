"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/lib/tenant";
import { canManageSettings } from "@/lib/authorization";
import { updateUserTenant } from "@/lib/user-directory";
import { services } from "@/services";

export interface CreateTenantState {
  error?: string;
}

/**
 * Admin-only: creates an additional (non-default) Tenant under the
 * caller's organization.
 */
export async function createTenant(_prevState: CreateTenantState, formData: FormData): Promise<CreateTenantState> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    return { error: "Only an organization admin can create tenants." };
  }

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) {
    return { error: "Tenant name is required." };
  }

  await services.tenants.createTenant(tenant.organizationId, displayName);
  revalidatePath("/settings");
  return {};
}

/**
 * Admin-only: moves the organization's default tenant — the one a join
 * request is assigned to on approval (see `membership-actions.ts`) — to
 * a different tenant. Doesn't move any existing member.
 */
export async function setDefaultTenant(tenantId: string): Promise<void> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    throw new Error("Only an organization admin can change the default tenant.");
  }

  const orgTenants = await services.tenants.listTenants(tenant.organizationId);
  const belongsToOrg = orgTenants.some((t) => t.id === tenantId);
  if (!belongsToOrg) {
    return;
  }

  await services.tenants.setDefaultTenant(tenant.organizationId, tenantId);
  revalidatePath("/settings");
}

/**
 * Self-service: the signed-in user switches which tenant within their
 * own organization they're currently scoped to. Available to any role,
 * not just admins — it only ever moves the caller themselves.
 */
export async function switchMyTenant(formData: FormData): Promise<void> {
  const tenant = await requireTenantContext();

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (!tenantId || tenantId === tenant.tenantId) {
    return;
  }

  const orgTenants = await services.tenants.listTenants(tenant.organizationId);
  const belongsToOrg = orgTenants.some((t) => t.id === tenantId);
  if (!belongsToOrg) {
    return;
  }

  await updateUserTenant(tenant.userId, tenantId);
  revalidatePath("/settings");
}
