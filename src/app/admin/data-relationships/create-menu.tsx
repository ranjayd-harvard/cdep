"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export type CreateMenuAction = "organization" | "tenant" | "dataset" | "dataProduct" | "entitlement";

const OPTIONS: Array<{ action: CreateMenuAction; label: string }> = [
  { action: "organization", label: "Create Organization" },
  { action: "tenant", label: "Create Tenant" },
  { action: "dataset", label: "Create Dataset" },
  { action: "dataProduct", label: "Create Data Product" },
  { action: "entitlement", label: "Grant Entitlement" },
];

export function CreateMenu({ onSelect }: { onSelect: (action: CreateMenuAction) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as globalThis.Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button type="button" size="sm" onClick={() => setOpen((v) => !v)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Create
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      {open ? (
        <div
          className={cn(
            "absolute right-0 z-20 mt-1 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg",
          )}
        >
          {OPTIONS.map((option) => (
            <button
              key={option.action}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(option.action);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
