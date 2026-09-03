"use client";

import { useActionState } from "react";
import { Button, Input, Select, type SelectOption } from "@/components/ui";
import { UserRole } from "@/models";
import { formatRole } from "@/lib/format-role";
import { inviteMember, type InviteMemberState } from "./invitation-actions";

const INITIAL_STATE: InviteMemberState = {};

const ROLE_OPTIONS: SelectOption[] = Object.values(UserRole).map((role) => ({
  label: formatRole(role),
  value: role,
}));

export function InviteForm({ tenantOptions }: { tenantOptions: SelectOption[] }) {
  const [state, formAction, pending] = useActionState(inviteMember, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">{state.success}</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Email" type="email" name="email" required autoComplete="off" />
        <Select label="Role" name="role" options={ROLE_OPTIONS} defaultValue={UserRole.CUSTOMER_USER} />
        {tenantOptions.length > 1 ? <Select label="Tenant" name="tenantId" options={tenantOptions} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}
