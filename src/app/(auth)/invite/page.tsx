import Link from "next/link";
import { Mail, XCircle } from "lucide-react";
import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { SignOutLink } from "@/components/auth/sign-out-link";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { findOrganizationById } from "@/lib/organization-directory";
import { findPendingInvitationByEmail } from "@/lib/organization-invitation-directory";
import { findPortalUserByEmail } from "@/lib/user-directory";
import { formatRole } from "@/lib/format-role";

interface InvitePageProps {
  searchParams: Promise<{ token?: string }>;
}

const PRIMARY_LINK_CLASS =
  "mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700";

/**
 * The public landing page for an emailed invite link (see
 * `sendOrganizationInviteEmail`, `src/lib/auth-emails.ts`). The token
 * here only proves the visitor received the email — it's single-use and
 * consumed on this one view. It does NOT itself grant membership: actual
 * acceptance happens at `/onboarding`, matched by the *signed-in*
 * session's email (see `acceptInvitation` in
 * `src/app/(auth)/onboarding/actions.ts`), so this page just routes the
 * visitor to sign in or sign up with the right email.
 */
export default async function InvitePage({ searchParams }: InvitePageProps) {
  const { token } = await searchParams;
  const email = token ? await consumeAuthToken(token, "org-invite") : null;
  const invitation = email ? await findPendingInvitationByEmail(email) : null;

  if (!email || !invitation) {
    return (
      <AuthCard>
        <div className="flex flex-col items-center gap-3 text-center">
          <XCircle className="h-10 w-10 text-red-500" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-900">Invitation not found</h2>
          <p className="text-sm text-slate-500">
            This invitation link is no longer valid — it may have expired, already been used, or been revoked. Ask
            whoever invited you to send a new one.
          </p>
          <Link href="/login" className="mt-2 text-sm font-medium text-slate-900 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  const [organization, existingAccount, session] = await Promise.all([
    findOrganizationById(invitation.organizationId),
    findPortalUserByEmail(email),
    auth(),
  ]);

  const organizationName = organization?.displayName ?? "this organization";
  const currentEmail = session?.user?.email?.trim().toLowerCase() ?? null;
  const alreadySignedInAsInvitee = currentEmail === email;
  const signedInAsSomeoneElse = currentEmail !== null && currentEmail !== email;

  return (
    <AuthCard>
      <div className="flex flex-col items-center gap-3 text-center">
        <Mail className="h-10 w-10 text-slate-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-900">You&apos;re invited</h2>
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">{email}</span> has been invited to join{" "}
          <span className="font-medium text-slate-900">{organizationName}</span> as{" "}
          <span className="font-medium text-slate-900">{formatRole(invitation.role)}</span>.
        </p>

        {alreadySignedInAsInvitee ? (
          <Link href="/onboarding" className={PRIMARY_LINK_CLASS}>
            Continue
          </Link>
        ) : signedInAsSomeoneElse ? (
          <>
            <p className="text-xs text-slate-400">
              You&apos;re signed in as {currentEmail}. Sign out to accept this invitation as {email}.
            </p>
            <SignOutLink />
          </>
        ) : existingAccount ? (
          <Link href="/login" className={PRIMARY_LINK_CLASS}>
            Sign in to accept
          </Link>
        ) : (
          <Link href={`/signup?email=${encodeURIComponent(email)}`} className={PRIMARY_LINK_CLASS}>
            Create your account
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
