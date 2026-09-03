import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "./signup-form";

interface SignupPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }
  const { email } = await searchParams;

  return (
    <AuthCard>
      <SignupForm defaultEmail={email} />

      <p className="mt-4 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-slate-900 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
