import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { MOCK_USERS } from "@/data/mocks/users";
import { LoginForm } from "./login-form";

interface LoginPageProps {
  searchParams: Promise<{ reset?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }
  const { reset } = await searchParams;

  return (
    <AuthCard>
      {reset === "success" ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Your password has been reset. Sign in with your new password.
        </p>
      ) : null}

      <LoginForm />

      <p className="mt-4 text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-slate-900 hover:underline">
          Sign up
        </Link>
      </p>

      <div className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <p className="mb-1 font-medium text-slate-700">Phase 1 demo accounts</p>
        <ul className="space-y-0.5">
          {MOCK_USERS.map((user) => (
            <li key={user.id}>
              {user.email} — {user.role?.replace("CUSTOMER_", "").toLowerCase()}
            </li>
          ))}
        </ul>
        <p className="mt-1">Password for all accounts: portal-demo</p>
      </div>
    </AuthCard>
  );
}
