"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { createTenant } from "@/lib/tenant-directory";
import { createPortalUser, findPortalUserByEmail, listPortalUsersByOrganization } from "@/lib/user-directory";
import { sendOrganizationStatusChangeEmail } from "@/lib/auth-emails";
import { PortalUserStatus, UserRole, type Organization } from "@/models";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin Console only: activates/deactivates an Organization. Doesn't
 * cascade to its Tenants or members — those are toggled independently
 * from the org detail page (`[organizationId]/actions.ts`). Every
 * currently-active member is emailed about the change; suspended and
 * still-pending-validation accounts are skipped since they can't sign in
 * either way.
 */
export async function setOrganizationStatus(organizationId: string, status: Organization["status"]): Promise<void> {
  await requireSuperuserContext();
  const organization = await services.organizations.getOrganization(organizationId);
  await services.organizations.setOrganizationStatus(organizationId, status);

  const members = await listPortalUsersByOrganization(organizationId);
  const activeMembers = members.filter((member) => member.status === PortalUserStatus.ACTIVE);
  await Promise.allSettled(
    activeMembers.map((member) =>
      sendOrganizationStatusChangeEmail(member.email, organization?.displayName ?? "Your organization", status),
    ),
  );

  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${organizationId}`);
}

export interface CreateOrganizationState {
  error?: string;
  success?: string;
}

/**
 * Admin Console only: creates a brand-new organization and its default
 * tenant, together with a pending first CUSTOMER_ADMIN account — the
 * only way an organization gets created now that self-serve creation
 * (the old `createOrganizationAndBecomeAdmin` in
 * `src/app/(auth)/onboarding/actions.ts`) has been removed. The admin
 * account starts PENDING_VALIDATION and can't sign in (see
 * `src/auth.ts`) until a superuser validates it (see
 * `validatePendingMember`, `./[organizationId]/actions.ts`).
 */
export async function createOrganizationWithAdmin(
  _prevState: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  await requireSuperuserContext();

  const displayName = String(formData.get("displayName") ?? "").trim();
  const adminName = String(formData.get("adminName") ?? "").trim();
  const adminEmail = String(formData.get("adminEmail") ?? "").trim().toLowerCase();

  if (!displayName) {
    return { error: "Organization name is required." };
  }
  if (!adminName) {
    return { error: "First admin name is required." };
  }
  if (!EMAIL_PATTERN.test(adminEmail)) {
    return { error: "Enter a valid email address for the first admin." };
  }

  const existingUser = await findPortalUserByEmail(adminEmail);
  if (existingUser) {
    return { error: "This email is already registered to an account." };
  }

  const organization = await services.organizations.createOrganization({ displayName });
  const tenant = await createTenant({ organizationId: organization.id, displayName: "Default", isDefault: true });
  await createPortalUser({
    name: adminName,
    email: adminEmail,
    organizationId: organization.id,
    tenantId: tenant.id,
    role: UserRole.CUSTOMER_ADMIN,
    passwordHash: null,
    status: PortalUserStatus.PENDING_VALIDATION,
  });

  revalidatePath("/admin/organizations");
  return { success: `${displayName} created — validate ${adminEmail} to activate its admin account.` };
}
