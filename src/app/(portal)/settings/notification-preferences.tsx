"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Preference {
  key: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}

const PREFERENCES: Preference[] = [
  { key: "exchange_failures", label: "Exchange failures", description: "Notify me when an exchange fails validation or processing.", defaultChecked: true },
  { key: "completed_exchanges", label: "Completed exchanges", description: "Notify me when an exchange completes successfully.", defaultChecked: true },
  { key: "new_datasets", label: "New datasets", description: "Notify me when a new data product becomes available.", defaultChecked: true },
  { key: "schema_changes", label: "Schema changes", description: "Notify me when a data product's schema or version changes.", defaultChecked: true },
  { key: "platform_notices", label: "Platform notices", description: "Notify me about scheduled maintenance and platform announcements.", defaultChecked: false },
];

export function NotificationPreferences() {
  const [preferences, setPreferences] = useState(() =>
    Object.fromEntries(PREFERENCES.map((pref) => [pref.key, pref.defaultChecked])),
  );

  return (
    <div className="flex flex-col gap-1">
      {PREFERENCES.map((pref) => (
        <label
          key={pref.key}
          className="flex cursor-pointer items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0"
        >
          <span>
            <span className="block text-sm font-medium text-slate-900">{pref.label}</span>
            <span className="block text-xs text-slate-500">{pref.description}</span>
          </span>
          <span className="relative inline-flex shrink-0 items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={preferences[pref.key]}
              onChange={() =>
                setPreferences((prev) => ({ ...prev, [pref.key]: !prev[pref.key] }))
              }
            />
            <span
              className={cn(
                "h-6 w-11 rounded-full bg-slate-200 transition-colors peer-checked:bg-slate-900",
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-slate-900",
              )}
            />
            <span
              className={cn(
                "absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform",
                preferences[pref.key] && "translate-x-5",
              )}
            />
          </span>
        </label>
      ))}
      <p className="mt-3 text-xs text-slate-400">
        Preferences shown here are for preview purposes and are not persisted in Phase 1.
      </p>
    </div>
  );
}
