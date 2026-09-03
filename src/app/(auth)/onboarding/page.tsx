import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { findOrganizationById } from "@/lib/organization-directory";
import { findPendingInvitationByEmail } from "@/lib/organization-invitation-directory";
import { findPendingRequestForUser } from "@/lib/organization-membership-directory";
import { UserRole } from "@/models";
import { OnboardingChoice } from "./onboarding-choice";
import { InvitationPrompt } from "./invitation-prompt";

/**
 * The post-login onboarding gate: every signed-in user without an
 * organization/tenant lands here (see `requireTenantContext` in
 * `src/lib/tenant.ts`) before they can reach the portal.
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // A superuser's org/tenant are permanently null — they belong in the
  // Admin Console, never in this org-joining flow (see
  // `requireTenantContext` in `src/lib/tenant.ts`, which normally catches
  // this first; this is a direct-navigation guard since /onboarding is a
  // public route).
  if (session.user.role === UserRole.SUPERUSER) {
    redirect("/admin");
  }

  if (session.user.organizationId && session.user.tenantId) {
    redirect("/dashboard");
  }

  // A pending invitation (an admin invited this exact email — see
  // src/app/(portal)/settings/invitation-actions.ts) takes priority over
  // both a self-initiated join request and the generic choice: it's a
  // stronger, already-approved signal, so there's nothing to wait on.
  const email = session.user.email?.trim().toLowerCase();
  const invitation = email ? await findPendingInvitationByEmail(email) : null;
  if (invitation) {
    const organization = await findOrganizationById(invitation.organizationId);
    return (
      <AuthCard>
        <InvitationPrompt organizationName={organization?.displayName ?? "this organization"} role={invitation.role} />
      </AuthCard>
    );
  }

  const pending = await findPendingRequestForUser(session.user.id);
  if (pending) {
    redirect("/onboarding/pending");
  }

  return (
    <AuthCard>
      <OnboardingChoice />
    </AuthCard>
  );
}
