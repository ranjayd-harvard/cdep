"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { updatePlatformSettings, type UpdatePlatformSettingsState } from "./actions";
import type { PlatformSettings } from "@/models";

const INITIAL_STATE: UpdatePlatformSettingsState = {};

export function PlatformSettingsForm({ settings }: { settings: PlatformSettings }) {
  const [state, formAction, pending] = useActionState(updatePlatformSettings, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="allowSelfServeSignup"
          defaultChecked={settings.allowSelfServeSignup}
          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/10"
        />
        Allow self-serve signup (email/password and first-time Google sign-in)
      </label>

      <Input
        label="Support email"
        name="supportEmail"
        type="email"
        defaultValue={settings.supportEmail}
        placeholder="support@example.com"
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {state.success ? <span className="text-xs text-emerald-600">Saved.</span> : null}
        {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
      </div>
    </form>
  );
}
