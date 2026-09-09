"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { createOrganizationWithAdmin, type CreateOrganizationState } from "./actions";

const INITIAL_STATE: CreateOrganizationState = {};

export function CreateOrganizationForm() {
  const [state, formAction, pending] = useActionState(createOrganizationWithAdmin, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">{state.success}</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Organization name" name="displayName" required autoComplete="organization" />
        <Input label="First admin name" name="adminName" required autoComplete="name" />
        <Input label="First admin email" type="email" name="adminEmail" required autoComplete="email" />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
