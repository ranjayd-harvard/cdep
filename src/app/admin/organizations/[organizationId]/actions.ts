"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { setPortalUserRole, setPortalUserStatus } from "@/lib/user-directory";
import type { PortalUserStatus, Tenant, UserRole } from "@/models";

/**
 * Admin Console only: activates/deactivates a single Tenant within any
 * Organization.
 */
export async function setTenantStatus(organizationId: string, tenantId: string, status: Tenant["status"]): Promise<void> {
  await requireSuperuserContext();
  await services.tenants.setTenantStatus(tenantId, status);
  revalidatePath(`/admin/organizations/${organizationId}`);
}

/**
 * Admin Console only: reassigns a member's role within their own
 * organization (the three customer roles — granting/revoking platform
 * root happens from `/admin/users` instead, kept as a deliberate,
 * org-independent action).
 */
export async function setMemberRole(organizationId: string, userId: string, role: UserRole): Promise<void> {
  await requireSuperuserContext();
  await setPortalUserRole(userId, role);
  revalidatePath(`/admin/organizations/${organizationId}`);
}

/** Form-bindable wrapper: reads the role picked in the `<select name="role">`. */
export async function setMemberRoleFromForm(organizationId: string, userId: string, formData: FormData): Promise<void> {
  const role = String(formData.get("role") ?? "") as UserRole;
  await setMemberRole(organizationId, userId, role);
}

export async function setMemberStatus(organizationId: string, userId: string, status: PortalUserStatus): Promise<void> {
  await requireSuperuserContext();
  await setPortalUserStatus(userId, status);
  revalidatePath(`/admin/organizations/${organizationId}`);
}

export async function approveMembershipRequest(organizationId: string, requestId: string): Promise<void> {
  const admin = await requireSuperuserContext();
  await services.organizationMemberships.approveRequest(requestId, admin.userId);
  revalidatePath(`/admin/organizations/${organizationId}`);
}

export async function rejectMembershipRequest(organizationId: string, requestId: string): Promise<void> {
  const admin = await requireSuperuserContext();
  await services.organizationMemberships.rejectRequest(requestId, admin.userId);
  revalidatePath(`/admin/organizations/${organizationId}`);
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
  await requireSuperuserContext();
  await services.organizationInvitations.revokeInvitation(invitationId);
  revalidatePath(`/admin/organizations/${organizationId}`);
}
