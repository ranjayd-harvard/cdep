"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Input, Modal } from "@/components/ui";
import type { Dataset } from "@/models";
import { associateDatasetAction } from "./actions";

export interface AddDatasetModalProps {
  open: boolean;
  onClose: () => void;
  dataProductId: string;
  dataProductName: string;
  datasets: Dataset[];
  alreadyAssociatedIds: Set<string>;
  onAssociated: () => void;
}

export function AddDatasetModal({
  open,
  onClose,
  dataProductId,
  dataProductName,
  datasets,
  alreadyAssociatedIds,
  onAssociated,
}: AddDatasetModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return datasets
      .filter((dataset) => !alreadyAssociatedIds.has(dataset.id))
      .filter((dataset) => !trimmed || dataset.displayName.toLowerCase().includes(trimmed));
  }, [datasets, alreadyAssociatedIds, query]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAdd() {
    const ids = [...selected];
    startTransition(async () => {
      await Promise.all(ids.map((datasetId) => associateDatasetAction(dataProductId, datasetId)));
      setSelected(new Set());
      onAssociated();
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add Dataset to ${dataProductName}`}>
      <div className="flex flex-col gap-3">
        <Input placeholder="Search datasets…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
          {filtered.length === 0 ? (
            <p className="p-2 text-sm text-slate-500">No matching datasets.</p>
          ) : (
            filtered.map((dataset) => (
              <label key={dataset.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selected.has(dataset.id)}
                  onChange={() => toggle(dataset.id)}
                  className="rounded border-slate-300"
                />
                <span className="text-slate-900">{dataset.displayName}</span>
                <span className="ml-auto text-xs text-slate-400">{dataset.domain}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || selected.size === 0} onClick={handleAdd}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
