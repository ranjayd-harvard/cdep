"use client";

import { useActionState, useState } from "react";
import { Button, Input, Modal } from "@/components/ui";
import { createApiKeyAction, type CreateApiKeyState } from "./actions";

const INITIAL_STATE: CreateApiKeyState = {};

export function CreateApiKeyForm() {
  const [state, formAction, pending] = useActionState(createApiKeyAction, INITIAL_STATE);

  // Each successful submission produces a new `state.createdSecret`. Track
  // which one the user has already dismissed as derived state (set during
  // render, not an effect) so a second key creation reopens the modal.
  const [lastSeenSecret, setLastSeenSecret] = useState<string | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);
  if (state.createdSecret !== lastSeenSecret) {
    setLastSeenSecret(state.createdSecret);
    setDismissed(false);
  }
  const revealedSecret =
    state.createdSecret && state.createdLabel && !dismissed
      ? { label: state.createdLabel, secret: state.createdSecret }
      : null;

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input label="New key label" name="label" placeholder="e.g. Production Uploads" required autoComplete="off" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create API key"}
        </Button>
      </form>
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}

      <Modal
        open={revealedSecret !== null}
        onClose={() => setDismissed(true)}
        title={`API key created: ${revealedSecret?.label ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            Copy this key now — for your security, it won&apos;t be shown again. If you lose it, revoke it and
            create a new one.
          </p>
          <code className="block overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-xs whitespace-nowrap text-slate-100">
            {revealedSecret?.secret}
          </code>
          <Button type="button" size="sm" onClick={() => setDismissed(true)} className="self-end">
            Done
          </Button>
        </div>
      </Modal>
    </div>
  );
}
