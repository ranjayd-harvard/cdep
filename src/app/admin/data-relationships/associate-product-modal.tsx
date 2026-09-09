"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Input, Modal } from "@/components/ui";
import type { DataProduct } from "@/models";
import { associateDatasetAction } from "./actions";

export interface AssociateProductModalProps {
  open: boolean;
  onClose: () => void;
  datasetId: string;
  datasetName: string;
  dataProducts: DataProduct[];
  alreadyAssociatedIds: Set<string>;
  onAssociated: () => void;
}

export function AssociateProductModal({
  open,
  onClose,
  datasetId,
  datasetName,
  dataProducts,
  alreadyAssociatedIds,
  onAssociated,
}: AssociateProductModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return dataProducts
      .filter((dataProduct) => !alreadyAssociatedIds.has(dataProduct.id))
      .filter((dataProduct) => !trimmed || dataProduct.displayName.toLowerCase().includes(trimmed));
  }, [dataProducts, alreadyAssociatedIds, query]);

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
      await Promise.all(ids.map((dataProductId) => associateDatasetAction(dataProductId, datasetId)));
      setSelected(new Set());
      onAssociated();
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Associate ${datasetName} with a Data Product`}>
      <div className="flex flex-col gap-3">
        <Input placeholder="Search data products…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
          {filtered.length === 0 ? (
            <p className="p-2 text-sm text-slate-500">No matching data products.</p>
          ) : (
            filtered.map((dataProduct) => (
              <label key={dataProduct.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selected.has(dataProduct.id)}
                  onChange={() => toggle(dataProduct.id)}
                  className="rounded border-slate-300"
                />
                <span className="text-slate-900">{dataProduct.displayName}</span>
                <span className="ml-auto text-xs text-slate-400">{dataProduct.domain}</span>
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
