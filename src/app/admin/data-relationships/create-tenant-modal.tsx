"use client";

import { useActionState } from "react";
import { Button, Input, Modal } from "@/components/ui";
import { createTenantAction, type ActionState } from "./actions";

const INITIAL_STATE: ActionState = {};

export interface CreateTenantModalProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  organizationName: string;
  onCreated: () => void;
}

export function CreateTenantModal({ open, onClose, organizationId, organizationName, onCreated }: CreateTenantModalProps) {
  const [state, formAction, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    const result = await createTenantAction(organizationId, prevState, formData);
    if (result.success) {
      onCreated();
      onClose();
    }
    return result;
  }, INITIAL_STATE);

  return (
    <Modal open={open} onClose={onClose} title={`Add Tenant to ${organizationName}`}>
      <form action={formAction} className="flex flex-col gap-3">
        {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
        <Input label="Tenant name" name="displayName" placeholder="Sandbox" required autoFocus />
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create Tenant"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
