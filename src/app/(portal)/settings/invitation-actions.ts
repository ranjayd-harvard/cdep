"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/lib/tenant";
import { canManageSettings } from "@/lib/authorization";
import { findPortalUserByEmail } from "@/lib/user-directory";
import { createAuthToken } from "@/lib/auth-tokens";
import { sendOrganizationInviteEmail } from "@/lib/auth-emails";
import { DuplicateInvitationError } from "@/lib/organization-invitation-directory";
import { services } from "@/services";
import { UserRole } from "@/models";

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteMemberState {
  error?: string;
  success?: string;
}

/**
 * Admin-only: invites someone by email to join the caller's organization
 * at a chosen role (and tenant, if the org has more than one). Sends an
 * emailed link (see `sendOrganizationInviteEmail`); actual acceptance
 * happens later at `/onboarding`, matched by the invitee's own signed-in
 * email (see `acceptInvitation`, `src/app/(auth)/onboarding/actions.ts`)
 * — this action only ever creates the pending record and sends the email.
 */
export async function inviteMember(_prevState: InviteMemberState, formData: FormData): Promise<InviteMemberState> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    return { error: "Only an organization admin can invite members." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const roleInput = String(formData.get("role") ?? "");
  if (!Object.values(UserRole).includes(roleInput as UserRole)) {
    return { error: "Choose a role." };
  }
  const role = roleInput as UserRole;

  const existingUser = await findPortalUserByEmail(email);
  if (existingUser?.organizationId) {
    return { error: "This person already belongs to an organization." };
  }

  const requestedTenantId = String(formData.get("tenantId") ?? "").trim();
  const orgTenants = await services.tenants.listTenants(tenant.organizationId);
  const targetTenant = requestedTenantId
    ? orgTenants.find((t) => t.id === requestedTenantId)
    : orgTenants.find((t) => t.isDefault);
  if (!targetTenant) {
    return { error: "Choose a tenant." };
  }

  try {
    await services.organizationInvitations.inviteToOrganization({
      organizationId: tenant.organizationId,
      tenantId: targetTenant.id,
      email,
      role,
      invitedBy: tenant.userId,
    });
  } catch (error) {
    if (error instanceof DuplicateInvitationError) {
      return { error: "This email already has a pending invitation." };
    }
    throw error;
  }

  const organization = await services.organizations.getOrganization(tenant.organizationId);
  const token = await createAuthToken(email, "org-invite", INVITE_TOKEN_TTL_MS);
  await sendOrganizationInviteEmail(email, token, organization?.displayName ?? "the organization");

  revalidatePath("/settings");
  return { success: `Invitation sent to ${email}.` };
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    throw new Error("Only an organization admin can revoke invitations.");
  }

  const pending = await services.organizationInvitations.listPendingInvitations(tenant.organizationId);
  const belongsToOrg = pending.some((invite) => invite.id === invitationId);
  if (!belongsToOrg) {
    return;
  }

  await services.organizationInvitations.revokeInvitation(invitationId);
  revalidatePath("/settings");
}
