"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const INITIAL_STATE: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, INITIAL_STATE);

  if (state.message) {
    return <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.message}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-slate-500">Enter your email and we&apos;ll send you a link to reset your password.</p>
      <Input label="Email" type="email" name="email" required autoComplete="email" />
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
