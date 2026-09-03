"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { resendVerificationEmail } from "./actions";

export function ResendButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={state !== "idle"}
        onClick={async () => {
          setState("sending");
          await resendVerificationEmail(email);
          setState("sent");
        }}
      >
        {state === "sent" ? "Email sent" : state === "sending" ? "Sending…" : "Resend verification email"}
      </Button>
      {state === "sent" ? <p className="text-xs text-slate-500">Check your inbox (and spam folder).</p> : null}
    </div>
  );
}
