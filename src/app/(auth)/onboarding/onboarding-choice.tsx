"use client";

import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import { Button, Input } from "@/components/ui";
import type { Organization } from "@/models";
import {
  createOrganizationAndBecomeAdmin,
  requestToJoinOrganization,
  searchOrganizations,
  type CreateOrganizationState,
} from "./actions";

const INITIAL_CREATE_STATE: CreateOrganizationState = {};

type Mode = "choose" | "join" | "create";

export function OnboardingChoice() {
  const [mode, setMode] = useState<Mode>("choose");

  if (mode === "join") {
    return <JoinOrganization onBack={() => setMode("choose")} />;
  }
  if (mode === "create") {
    return <CreateOrganization onBack={() => setMode("choose")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h2 className="text-base font-semibold text-slate-900">Set up your workspace</h2>
        <p className="mt-1 text-sm text-slate-500">Do you belong to an existing organization?</p>
      </div>
      <Button className="w-full" onClick={() => setMode("join")}>
        Yes, find my organization
      </Button>
      <Button variant="secondary" className="w-full" onClick={() => setMode("create")}>
        No, create a new organization
      </Button>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="self-start text-xs font-medium text-slate-500 hover:text-slate-900"
    >
      ← Back
    </button>
  );
}

function JoinOrganization({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Organization[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSearch(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setQuery(value);

    if (!value.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setSearching(true);
    const matches = await searchOrganizations(value);
    setResults(matches);
    setSearching(false);
    setSearched(true);
  }

  function handleRequest(organizationId: string) {
    setRequestedId(organizationId);
    startTransition(() => {
      requestToJoinOrganization(organizationId);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <Input label="Organization name" placeholder="Search by name…" value={query} onChange={handleSearch} />

      {searching ? <p className="text-sm text-slate-400">Searching…</p> : null}
      {!searching && searched && results.length === 0 ? (
        <p className="text-sm text-slate-500">No organizations match &quot;{query}&quot;.</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {results.map((org) => (
            <li
              key={org.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
            >
              <span className="text-sm text-slate-900">{org.displayName}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={isPending && requestedId === org.id}
                onClick={() => handleRequest(org.id)}
              >
                {isPending && requestedId === org.id ? "Requesting…" : "Request to join"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CreateOrganization({ onBack }: { onBack: () => void }) {
  const [state, formAction, pending] = useActionState(createOrganizationAndBecomeAdmin, INITIAL_CREATE_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <BackButton onBack={onBack} />
      {state.error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <Input label="Organization name" name="displayName" required autoComplete="organization" />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
