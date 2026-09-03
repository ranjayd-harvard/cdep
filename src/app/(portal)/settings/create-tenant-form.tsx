"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { createTenant, type CreateTenantState } from "./tenant-actions";

const INITIAL_STATE: CreateTenantState = {};

export function CreateTenantForm() {
  const [state, formAction, pending] = useActionState(createTenant, INITIAL_STATE);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input label="New tenant name" name="displayName" required autoComplete="off" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create tenant"}
        </Button>
      </form>
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </div>
  );
}
