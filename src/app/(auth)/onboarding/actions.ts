"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createOrganization, searchOrganizationsByName } from "@/lib/organization-directory";
import { createTenant } from "@/lib/tenant-directory";
import { createMembershipRequest, DuplicateMembershipRequestError } from "@/lib/organization-membership-directory";
import {
  acceptInvitation as acceptInvitationRecord,
  declineInvitation as declineInvitationRecord,
  findPendingInvitationByEmail,
} from "@/lib/organization-invitation-directory";
import { assignPortalUserToOrganization } from "@/lib/user-directory";
import { UserRole, type Organization } from "@/models";

/**
 * Shared guard for every onboarding action: must be signed in, and must
 * not already belong to an organization (a second submit, a stale tab,
 * or a direct call after onboarding already completed all land back on
 * `/dashboard` instead of silently re-running).
 */
async function requireOnboardingUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.organizationId) {
    redirect("/dashboard");
  }
  return session.user;
}

export async function searchOrganizations(query: string): Promise<Organization[]> {
  await requireOnboardingUser();
  return searchOrganizationsByName(query);
}

/**
 * Requests to join an existing organization. A CUSTOMER_ADMIN of that
 * org must approve it (see
 * `src/app/(portal)/settings/membership-actions.ts`) before the
 * requester's session picks up an organizationId/tenantId — see the
 * `jwt` callback's lazy-refresh branch in `src/auth.ts`.
 */
export async function requestToJoinOrganization(organizationId: string): Promise<void> {
  const user = await requireOnboardingUser();

  try {
    await createMembershipRequest({
      organizationId,
      userId: user.id,
      userName: user.name ?? "",
      userEmail: user.email ?? "",
    });
  } catch (error) {
    // Already has a pending request (e.g. a double submit) — treat as
    // success rather than surfacing an error, since the end state
    // (waiting on approval) is the same either way.
    if (!(error instanceof DuplicateMembershipRequestError)) {
      throw error;
    }
  }

  redirect("/onboarding/pending");
}

export interface CreateOrganizationState {
  error?: string;
}

/**
 * Creates a brand-new organization and its default tenant, then makes
 * the caller its CUSTOMER_ADMIN immediately — the same outcome
 * self-serve signup used to produce inline, just resolved here instead.
 */
export async function createOrganizationAndBecomeAdmin(
  _prevState: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  const user = await requireOnboardingUser();

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) {
    return { error: "Organization name is required." };
  }

  const organization = await createOrganization({ displayName });
  const tenant = await createTenant({ organizationId: organization.id, displayName: "Default", isDefault: true });
  await assignPortalUserToOrganization(user.id, {
    organizationId: organization.id,
    tenantId: tenant.id,
    role: UserRole.CUSTOMER_ADMIN,
  });

  redirect("/dashboard");
}

/**
 * Accepts a pending invitation matched to the caller's own signed-in
 * email — never trusts an id passed from the client, so there's no way
 * to accept an invitation addressed to someone else. Grants exactly the
 * organization/tenant/role the inviting admin chose (see
 * `src/app/(portal)/settings/invitation-actions.ts`); unlike an approved
 * join request, there's no fixed CUSTOMER_USER default here, because the
 * admin already picked a role up front.
 */
export async function acceptInvitation(): Promise<void> {
  const user = await requireOnboardingUser();

  const email = (user.email ?? "").trim().toLowerCase();
  const invitation = email ? await findPendingInvitationByEmail(email) : null;
  if (!invitation) {
    redirect("/onboarding");
  }

  await assignPortalUserToOrganization(user.id, {
    organizationId: invitation.organizationId,
    tenantId: invitation.tenantId,
    role: invitation.role,
  });
  await acceptInvitationRecord(invitation.id);

  redirect("/dashboard");
}

export async function declineInvitation(): Promise<void> {
  const user = await requireOnboardingUser();

  const email = (user.email ?? "").trim().toLowerCase();
  const invitation = email ? await findPendingInvitationByEmail(email) : null;
  if (invitation) {
    await declineInvitationRecord(invitation.id);
  }

  redirect("/onboarding");
}
