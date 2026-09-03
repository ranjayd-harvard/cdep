"use client";

import { useTransition } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui";
import { formatRole } from "@/lib/format-role";
import type { UserRole } from "@/models";
import { acceptInvitation, declineInvitation } from "./actions";

export function InvitationPrompt({
  organizationName,
  role,
}: {
  organizationName: string;
  role: UserRole;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Mail className="h-10 w-10 text-slate-400" aria-hidden="true" />
      <div>
        <h2 className="text-base font-semibold text-slate-900">You&apos;ve been invited</h2>
        <p className="mt-1 text-sm text-slate-500">
          Join <span className="font-medium text-slate-900">{organizationName}</span> as{" "}
          <span className="font-medium text-slate-900">{formatRole(role)}</span>
        </p>
      </div>

      <Button
        className="w-full"
        disabled={isPending}
        onClick={() =>
          startTransition(() => {
            acceptInvitation();
          })
        }
      >
        {isPending ? "Joining…" : "Accept invitation"}
      </Button>
      <Button
        variant="secondary"
        className="w-full"
        disabled={isPending}
        onClick={() =>
          startTransition(() => {
            declineInvitation();
          })
        }
      >
        Decline
      </Button>
    </div>
  );
}
