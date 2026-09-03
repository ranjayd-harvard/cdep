import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendButton } from "./resend-button";

interface CheckEmailPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function CheckEmailPage({ searchParams }: CheckEmailPageProps) {
  const { email = "" } = await searchParams;

  return (
    <AuthCard>
      <div className="flex flex-col items-center gap-3 text-center">
        <MailCheck className="h-10 w-10 text-slate-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-900">Check your email</h2>
        <p className="text-sm text-slate-500">
          {email ? (
            <>
              We&apos;ve sent a verification link to <span className="font-medium text-slate-700">{email}</span>.
            </>
          ) : (
            "We've sent a verification link to your email."
          )}{" "}
          Click it to activate your account.
        </p>

        {email ? <ResendButton email={email} /> : null}

        <Link href="/login" className="mt-2 text-sm font-medium text-slate-900 hover:underline">
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
