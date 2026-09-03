"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { resetPassword, type ResetPasswordState } from "./actions";

const INITIAL_STATE: ResetPasswordState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <input type="hidden" name="token" value={token} />
      <Input
        label="New password"
        type="password"
        name="password"
        required
        autoComplete="new-password"
        hint="At least 8 characters."
      />
      <Input label="Confirm new password" type="password" name="confirmPassword" required autoComplete="new-password" />
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}
