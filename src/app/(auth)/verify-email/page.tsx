import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { verifyPortalUserEmail } from "@/lib/user-directory";

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;
  const email = token ? await consumeAuthToken(token, "verify-email") : null;

  if (email) {
    await verifyPortalUserEmail(email);
  }

  return (
    <AuthCard>
      <div className="flex flex-col items-center gap-3 text-center">
        {email ? (
          <>
            <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Email verified</h2>
            <p className="text-sm text-slate-500">Your account is active. You can sign in now.</p>
            <Link
              href="/login"
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            <XCircle className="h-10 w-10 text-red-500" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Link expired or invalid</h2>
            <p className="text-sm text-slate-500">
              This verification link is no longer valid. Request a new one from the sign-in page.
            </p>
            <Link href="/login" className="mt-2 text-sm font-medium text-slate-900 hover:underline">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </AuthCard>
  );
}
