"use client";

import { useActionState, useState } from "react";
import { Button, Input, Modal, Select } from "@/components/ui";
import type { DataProduct } from "@/models";
import { deleteDataProductAction, updateDataProductAction, type DataProductFormState } from "./actions";
import { STATUS_OPTIONS } from "./status-options";

const INITIAL_STATE: DataProductFormState = {};

export function DataProductRowActions({ dataProduct }: { dataProduct: DataProduct }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prevState: DataProductFormState, formData: FormData) => {
    const result = await updateDataProductAction(dataProduct.id, prevState, formData);
    if (result.success) setOpen(false);
    return result;
  }, INITIAL_STATE);

  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <form action={deleteDataProductAction.bind(null, dataProduct.id)}>
        <Button type="submit" size="sm" variant="danger">
          Delete
        </Button>
      </form>

      <Modal open={open} onClose={() => setOpen(false)} title={`Edit ${dataProduct.displayName}`}>
        <form action={formAction} className="flex flex-col gap-3">
          {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
          <Input label="Internal name" name="name" defaultValue={dataProduct.name} required />
          <Input label="Display name" name="displayName" defaultValue={dataProduct.displayName} required />
          <Input label="Description" name="description" defaultValue={dataProduct.description} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Domain" name="domain" defaultValue={dataProduct.domain} />
            <Input label="Owner" name="owner" defaultValue={dataProduct.owner} />
          </div>
          <Select label="Status" name="status" defaultValue={dataProduct.status} options={STATUS_OPTIONS} />
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
