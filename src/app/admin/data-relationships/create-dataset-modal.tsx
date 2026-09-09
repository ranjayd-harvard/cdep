"use client";

import { Modal } from "@/components/ui";
import { DatasetForm } from "@/app/admin/data-products/[dataProductId]/dataset-form";
import { createDatasetAction } from "./actions";

export interface CreateDatasetModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateDatasetModal({ open, onClose, onCreated }: CreateDatasetModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Create Dataset" className="max-w-3xl">
      <DatasetForm
        action={async (prevState, formData) => {
          const result = await createDatasetAction(prevState, formData);
          if (result.success) {
            onCreated();
            onClose();
          }
          return result;
        }}
        submitLabel="Create dataset"
        pendingLabel="Creating…"
      />
    </Modal>
  );
}
