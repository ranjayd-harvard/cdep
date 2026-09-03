"use client";

import { useActionState } from "react";
import { signIn } from "next-auth/react";
import { Button, Input } from "@/components/ui";
import { signup, type SignupState } from "./actions";

const INITIAL_STATE: SignupState = {};

export function SignupForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(signup, INITIAL_STATE);

  return (
    <div className="flex flex-col gap-4">
      {state.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
      >
        Sign up with Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        or
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <Input label="Your name" name="name" required autoComplete="name" />
        <Input
          label="Email"
          type="email"
          name="email"
          required
          autoComplete="email"
          defaultValue={defaultEmail}
        />
        <Input
          label="Password"
          type="password"
          name="password"
          required
          autoComplete="new-password"
          hint="At least 8 characters."
        />
        <Input
          label="Confirm password"
          type="password"
          name="confirmPassword"
          required
          autoComplete="new-password"
        />
        <Button type="submit" disabled={pending} className="mt-2 w-full">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
