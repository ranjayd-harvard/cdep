import { redirect } from "next/navigation";
import { Hourglass } from "lucide-react";
import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { findOrganizationById } from "@/lib/organization-directory";
import { findPendingRequestForUser } from "@/lib/organization-membership-directory";
import { SignOutLink } from "@/components/auth/sign-out-link";

export default async function OnboardingPendingPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.organizationId && session.user.tenantId) {
    redirect("/dashboard");
  }

  const pending = await findPendingRequestForUser(session.user.id);
  if (!pending) {
    // No PENDING request left — either it was just approved (the
    // redirect above will fire once the session refreshes) or it was
    // rejected, in which case the user picks again from the top.
    redirect("/onboarding");
  }

  const organization = await findOrganizationById(pending.organizationId);

  return (
    <AuthCard>
      <div className="flex flex-col items-center gap-3 text-center">
        <Hourglass className="h-10 w-10 text-slate-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-900">Request pending</h2>
        <p className="text-sm text-slate-500">
          Your request to join{" "}
          <span className="font-medium text-slate-900">{organization?.displayName ?? "this organization"}</span> is
          waiting for an admin to approve it.
        </p>
        <a
          href="/onboarding/pending"
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
        >
          Check again
        </a>
        <SignOutLink />
      </div>
    </AuthCard>
  );
}
