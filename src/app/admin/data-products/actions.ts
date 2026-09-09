"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { DataProductStatus, type DataProduct } from "@/models";
import type { DataProductInput } from "@/services/interfaces";

export interface DataProductFormState {
  error?: string;
  success?: string;
}

function readDataProductInput(formData: FormData): DataProductInput | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const domain = String(formData.get("domain") ?? "").trim();
  const owner = String(formData.get("owner") ?? "").trim();
  const status = String(formData.get("status") ?? "") as DataProduct["status"];

  if (!name) return { error: "Internal name is required." };
  if (!displayName) return { error: "Display name is required." };
  if (!Object.values(DataProductStatus).includes(status)) return { error: "Choose a valid status." };

  return { name, displayName, description, domain, owner, status };
}

/**
 * Admin Console only (`src/app/admin/data-products`): adds a new catalog
 * entry. This is the shared catalog `platform-init.sh` wipes along with
 * the rest of Mongo — the way to get data products back without
 * re-running `npm run seed-catalog`.
 */
export async function createDataProductAction(
  _prevState: DataProductFormState,
  formData: FormData,
): Promise<DataProductFormState> {
  await requireSuperuserContext();

  const input = readDataProductInput(formData);
  if ("error" in input) return { error: input.error };

  const dataProduct = await services.dataProducts.createDataProduct(input);
  revalidatePath("/admin/data-products");
  return { success: `${dataProduct.displayName} created.` };
}

export async function updateDataProductAction(
  dataProductId: string,
  _prevState: DataProductFormState,
  formData: FormData,
): Promise<DataProductFormState> {
  await requireSuperuserContext();

  const input = readDataProductInput(formData);
  if ("error" in input) return { error: input.error };

  const dataProduct = await services.dataProducts.updateDataProduct(dataProductId, input);
  if (!dataProduct) return { error: "That data product no longer exists." };

  revalidatePath("/admin/data-products");
  return { success: `${dataProduct.displayName} updated.` };
}

export async function deleteDataProductAction(dataProductId: string): Promise<void> {
  await requireSuperuserContext();
  await services.dataProducts.deleteDataProduct(dataProductId);
  revalidatePath("/admin/data-products");
}
