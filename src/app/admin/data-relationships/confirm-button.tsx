"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui";

export interface ConfirmButtonProps extends Omit<ButtonProps, "onClick"> {
  confirmLabel: string;
  confirmDescription?: string;
  onConfirm: () => void;
}

/**
 * A two-step "are you sure?" affordance for destructive-feeling actions
 * (revoke an entitlement, dissociate a dataset from an active product).
 * The codebase has no confirm-dialog component, so this stays inline
 * rather than a one-off `window.confirm`.
 */
export function ConfirmButton({ confirmLabel, confirmDescription, onConfirm, children, ...props }: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" {...props} onClick={() => setConfirming(true)}>
        {children}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2">
      {confirmDescription ? <p className="text-xs text-amber-800">{confirmDescription}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="danger"
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
