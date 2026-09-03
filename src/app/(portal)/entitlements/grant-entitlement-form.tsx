"use client";

import { useActionState } from "react";
import { Button, Select, type SelectOption } from "@/components/ui";
import { grantEntitlement, type GrantEntitlementState } from "./entitlement-actions";

const INITIAL_STATE: GrantEntitlementState = {};

export function GrantEntitlementForm({
  tenantId,
  dataProductOptions,
}: {
  tenantId: string;
  dataProductOptions: SelectOption[];
}) {
  const [state, formAction, pending] = useActionState(grantEntitlement.bind(null, tenantId), INITIAL_STATE);

  if (dataProductOptions.length === 0) {
    return <p className="text-sm text-slate-500">This tenant already has access to the entire catalog.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">{state.success}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Data product" name="dataProductId" options={dataProductOptions} className="min-w-64" />
        <Button type="submit" disabled={pending}>
          {pending ? "Granting…" : "Grant access"}
        </Button>
      </div>
    </form>
  );
}
