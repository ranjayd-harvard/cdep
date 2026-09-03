"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext, type TenantContext } from "@/lib/tenant";
import { canManageEntitlements } from "@/lib/authorization";
import { services } from "@/services";

export interface GrantEntitlementState {
  error?: string;
  success?: string;
}

async function belongsToOrg(tenant: TenantContext, tenantId: string): Promise<boolean> {
  const orgTenants = await services.tenants.listTenants(tenant.organizationId);
  return orgTenants.some((t) => t.id === tenantId);
}

/**
 * Admin-only: grants a tenant access to a data product. `tenantId` is
 * bound at the call site (see `grant-entitlement-form.tsx`), not read
 * from the form, but is still re-validated against the caller's own
 * organization before writing anything — the same defensive-lookup
 * pattern used throughout `src/app/(portal)/settings/*-actions.ts`.
 */
export async function grantEntitlement(
  tenantId: string,
  _prevState: GrantEntitlementState,
  formData: FormData,
): Promise<GrantEntitlementState> {
  const tenant = await requireTenantContext();
  if (!canManageEntitlements(tenant.role)) {
    return { error: "Only an organization admin can grant entitlements." };
  }

  if (!(await belongsToOrg(tenant, tenantId))) {
    return { error: "Unknown tenant." };
  }

  const dataProductId = String(formData.get("dataProductId") ?? "").trim();
  if (!dataProductId) {
    return { error: "Choose a data product." };
  }

  await services.entitlements.grantEntitlement(tenantId, dataProductId, tenant.email);
  revalidatePath("/entitlements");
  return { success: "Access granted." };
}

/**
 * Admin-only: revokes an entitlement in place (status -> REVOKED) rather
 * than deleting it, so the grant's history is preserved. Re-fetches the
 * tenant's own entitlements to confirm `entitlementId` actually belongs
 * to it before writing — the same pattern `revokeInvitation` uses.
 */
export async function revokeEntitlement(tenantId: string, entitlementId: string): Promise<void> {
  const tenant = await requireTenantContext();
  if (!canManageEntitlements(tenant.role)) {
    throw new Error("Only an organization admin can revoke entitlements.");
  }

  if (!(await belongsToOrg(tenant, tenantId))) {
    return;
  }

  const existing = await services.entitlements.getEntitlements(tenantId);
  if (!existing.some((entitlement) => entitlement.id === entitlementId)) {
    return;
  }

  await services.entitlements.revokeEntitlement(tenantId, entitlementId);
  revalidatePath("/entitlements");
}

/** Admin-only: the inverse of `revokeEntitlement` — sets status back to ACTIVE. */
export async function reactivateEntitlement(tenantId: string, entitlementId: string): Promise<void> {
  const tenant = await requireTenantContext();
  if (!canManageEntitlements(tenant.role)) {
    throw new Error("Only an organization admin can reactivate entitlements.");
  }

  if (!(await belongsToOrg(tenant, tenantId))) {
    return;
  }

  const existing = await services.entitlements.getEntitlements(tenantId);
  if (!existing.some((entitlement) => entitlement.id === entitlementId)) {
    return;
  }

  await services.entitlements.reactivateEntitlement(tenantId, entitlementId);
  revalidatePath("/entitlements");
}
