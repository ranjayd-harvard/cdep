"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import {
  findPortalUserById,
  setPortalUserRole,
  setPortalUserStatus,
  verifyPortalUserEmail,
} from "@/lib/user-directory";
import { createAuthToken } from "@/lib/auth-tokens";
import { sendAccountValidatedEmail } from "@/lib/auth-emails";
import { PortalUserStatus, type Tenant, type UserRole } from "@/models";

const VALIDATION_TOKEN_TTL_MS = 60 * 60 * 1000;

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

/**
 * Admin Console only: approves an org's first CUSTOMER_ADMIN account
 * (created PENDING_VALIDATION by `createOrganizationWithAdmin`, see
 * `../actions.ts`). Marks the account ACTIVE and its email verified —
 * standing in for the normal signup verification step, which an
 * admin-created account never went through — then emails a
 * `reset-password` link so the new admin can set a password and sign in.
 */
export async function validatePendingMember(organizationId: string, userId: string): Promise<void> {
  await requireSuperuserContext();

  const member = await findPortalUserById(userId);
  if (!member || member.status !== PortalUserStatus.PENDING_VALIDATION) {
    return;
  }

  await setPortalUserStatus(userId, PortalUserStatus.ACTIVE);
  await verifyPortalUserEmail(member.email);

  const organization = await services.organizations.getOrganization(organizationId);
  const token = await createAuthToken(member.email, "reset-password", VALIDATION_TOKEN_TTL_MS);
  await sendAccountValidatedEmail(member.email, token, organization?.displayName ?? "your organization");

  revalidatePath(`/admin/organizations/${organizationId}`);
}

/**
 * Admin Console only: grants a Tenant access to a Data Product from the
 * catalog (`/admin/data-products`). This is the only place that
 * relationship is created — a data product existing in the catalog
 * doesn't, by itself, make it visible to any tenant's portal.
 */
export async function grantEntitlement(organizationId: string, tenantId: string, formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const dataProductId = String(formData.get("dataProductId") ?? "").trim();
  if (!dataProductId) return;

  await services.entitlements.grantEntitlement(tenantId, dataProductId, admin.userId);
  revalidatePath(`/admin/organizations/${organizationId}`);
}

/** Toggles an existing Entitlement between ACTIVE and REVOKED. */
export async function setEntitlementActive(
  organizationId: string,
  tenantId: string,
  entitlementId: string,
  active: boolean,
): Promise<void> {
  await requireSuperuserContext();
  if (active) {
    await services.entitlements.reactivateEntitlement(tenantId, entitlementId);
  } else {
    await services.entitlements.revokeEntitlement(tenantId, entitlementId);
  }
  revalidatePath(`/admin/organizations/${organizationId}`);
}
