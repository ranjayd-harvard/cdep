"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { readDatasetInput } from "./dataset-input";

export interface DatasetFormState {
  error?: string;
  success?: string;
}

/**
 * Admin Console only (`src/app/admin/data-products/[dataProductId]`):
 * adds a Dataset under a Data Product. This is what the customer-facing
 * "Data Products" page (`/datasets`) actually lists — a Data Product with
 * no Datasets under it shows up empty there even once a tenant is
 * entitled to it.
 */
export async function createDatasetAction(
  dataProductId: string,
  _prevState: DatasetFormState,
  formData: FormData,
): Promise<DatasetFormState> {
  await requireSuperuserContext();

  const input = readDatasetInput(formData);
  if ("error" in input) return { error: input.error };

  const dataset = await services.datasets.createDataset(input);
  await services.datasets.associateDataset(dataProductId, dataset.id);
  revalidatePath(`/admin/data-products/${dataProductId}`);
  return { success: `${dataset.displayName} created.` };
}

export async function updateDatasetAction(
  dataProductId: string,
  datasetId: string,
  _prevState: DatasetFormState,
  formData: FormData,
): Promise<DatasetFormState> {
  await requireSuperuserContext();

  const input = readDatasetInput(formData);
  if ("error" in input) return { error: input.error };

  const dataset = await services.datasets.updateDataset(datasetId, input);
  if (!dataset) return { error: "That dataset no longer exists." };

  revalidatePath(`/admin/data-products/${dataProductId}`);
  return { success: `${dataset.displayName} updated.` };
}

export async function deleteDatasetAction(dataProductId: string, datasetId: string): Promise<void> {
  await requireSuperuserContext();
  await services.datasets.deleteDataset(datasetId);
  revalidatePath(`/admin/data-products/${dataProductId}`);
}
