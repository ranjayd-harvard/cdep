import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "./reset-password-form";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token = "" } = await searchParams;

  if (!token) {
    return (
      <AuthCard>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-slate-500">This reset link is missing its token.</p>
          <Link href="/forgot-password" className="text-sm font-medium text-slate-900 hover:underline">
            Request a new link
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
