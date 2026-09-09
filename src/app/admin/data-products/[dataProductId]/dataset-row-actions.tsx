"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { Dataset } from "@/models";
import { deleteDatasetAction, updateDatasetAction } from "./actions";
import { DatasetForm } from "./dataset-form";

export function DatasetRowActions({ dataProductId, dataset }: { dataProductId: string; dataset: Dataset }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <form action={deleteDatasetAction.bind(null, dataProductId, dataset.id)}>
        <Button type="submit" size="sm" variant="danger">
          Delete
        </Button>
      </form>

      <Modal open={open} onClose={() => setOpen(false)} title={`Edit ${dataset.displayName}`} className="max-w-3xl">
        <DatasetForm
          dataset={dataset}
          action={updateDatasetAction.bind(null, dataProductId, dataset.id)}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </Modal>
    </div>
  );
}
