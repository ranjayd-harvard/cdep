"use client";

import { useActionState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { createDataProductAction, type DataProductFormState } from "./actions";
import { STATUS_OPTIONS } from "./status-options";

const INITIAL_STATE: DataProductFormState = {};

export function CreateDataProductForm() {
  const [state, formAction, pending] = useActionState(createDataProductAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">{state.success}</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input label="Internal name" name="name" placeholder="customer_insights" required />
        <Input label="Display name" name="displayName" placeholder="Customer Insights" required />
        <Input label="Domain" name="domain" placeholder="Customer" />
        <Input label="Owner" name="owner" placeholder="Customer Data Platform Team" />
        <Select label="Status" name="status" defaultValue="ACTIVE" options={STATUS_OPTIONS} />
      </div>
      <Input label="Description" name="description" placeholder="What this data product covers" />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating…" : "Create data product"}
      </Button>
    </form>
  );
}
