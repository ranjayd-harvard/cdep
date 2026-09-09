"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { DataProductStatus, DatasetStatus, EntitlementStatus, type Organization, type Tenant } from "@/models";
import { readDatasetInput } from "@/app/admin/data-products/[dataProductId]/dataset-input";
import type { DatasetFormState } from "@/app/admin/data-products/[dataProductId]/actions";

const PATH = "/admin/data-relationships";

export interface ActionState {
  error?: string;
  success?: string;
}

/** Admin Console only: creates a new, non-default Tenant under an Organization. */
export async function createTenantAction(
  organizationId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperuserContext();

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) return { error: "Tenant name is required." };

  const tenant = await services.tenants.createTenant(organizationId, displayName);
  revalidatePath(PATH);
  return { success: `${tenant.displayName} created.` };
}

/**
 * Catalog-level Dataset creation, not tied to any one Data Product —
 * association happens separately via `associateDatasetAction`. Reuses
 * the same field parsing as the "create a dataset under this product"
 * flow (`src/app/admin/data-products/[dataProductId]/actions.ts`).
 */
export async function createDatasetAction(
  _prevState: DatasetFormState,
  formData: FormData,
): Promise<DatasetFormState> {
  await requireSuperuserContext();

  const input = readDatasetInput(formData);
  if ("error" in input) return { error: input.error };

  const dataset = await services.datasets.createDataset(input);
  revalidatePath(PATH);
  return { success: `${dataset.displayName} created.` };
}

/**
 * Grants a Tenant access to a Data Product. Rejects a second active grant
 * for the same tenant + data product pair rather than creating a
 * duplicate entitlement record.
 */
export async function grantEntitlementAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireSuperuserContext();

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const dataProductId = String(formData.get("dataProductId") ?? "").trim();
  const validUntilRaw = String(formData.get("validUntil") ?? "").trim();

  if (!tenantId) return { error: "Choose a tenant." };
  if (!dataProductId) return { error: "Choose a data product." };

  const existing = await services.entitlements.getEntitlements(tenantId);
  const duplicate = existing.some(
    (entitlement) => entitlement.dataProductId === dataProductId && entitlement.status === EntitlementStatus.ACTIVE,
  );
  if (duplicate) {
    return { error: "This tenant already has an active entitlement for that data product." };
  }

  const expiresAt = validUntilRaw ? new Date(validUntilRaw).toISOString() : null;
  await services.entitlements.grantEntitlement(tenantId, dataProductId, admin.userId, expiresAt);
  revalidatePath(PATH);
  return { success: "Entitlement granted." };
}

export async function revokeEntitlementAction(tenantId: string, entitlementId: string): Promise<void> {
  await requireSuperuserContext();
  await services.entitlements.revokeEntitlement(tenantId, entitlementId);
  revalidatePath(PATH);
}

export async function reactivateEntitlementAction(tenantId: string, entitlementId: string): Promise<void> {
  await requireSuperuserContext();
  await services.entitlements.reactivateEntitlement(tenantId, entitlementId);
  revalidatePath(PATH);
}

export async function setEntitlementExpiryAction(
  tenantId: string,
  entitlementId: string,
  formData: FormData,
): Promise<void> {
  await requireSuperuserContext();
  const raw = String(formData.get("validUntil") ?? "").trim();
  await services.entitlements.setEntitlementExpiry(tenantId, entitlementId, raw ? new Date(raw).toISOString() : null);
  revalidatePath(PATH);
}

export async function associateDatasetAction(dataProductId: string, datasetId: string): Promise<void> {
  await requireSuperuserContext();
  await services.datasets.associateDataset(dataProductId, datasetId);
  revalidatePath(PATH);
}

export async function dissociateDatasetAction(dataProductId: string, datasetId: string): Promise<void> {
  await requireSuperuserContext();
  await services.datasets.dissociateDataset(dataProductId, datasetId);
  revalidatePath(PATH);
}

export async function setOrganizationStatusAction(
  organizationId: string,
  status: Organization["status"],
): Promise<void> {
  await requireSuperuserContext();
  await services.organizations.setOrganizationStatus(organizationId, status);
  revalidatePath(PATH);
}

export async function setTenantStatusAction(tenantId: string, status: Tenant["status"]): Promise<void> {
  await requireSuperuserContext();
  await services.tenants.setTenantStatus(tenantId, status);
  revalidatePath(PATH);
}

/** Safe deletion for a Data Product: flips it to DEPRECATED rather than removing the catalog entry. */
export async function retireDataProductAction(dataProductId: string): Promise<void> {
  await requireSuperuserContext();
  const current = (await services.dataProducts.listAllDataProducts()).find((dp) => dp.id === dataProductId);
  if (!current) return;
  await services.dataProducts.updateDataProduct(dataProductId, { ...current, status: DataProductStatus.DEPRECATED });
  revalidatePath(PATH);
}

/** Safe deletion for a Dataset: flips it to DEPRECATED rather than removing the catalog entry. */
export async function retireDatasetAction(datasetId: string): Promise<void> {
  await requireSuperuserContext();
  const current = (await services.datasets.listAllDatasets()).find((dataset) => dataset.id === datasetId);
  if (!current) return;
  await services.datasets.updateDataset(datasetId, { ...current, status: DatasetStatus.DEPRECATED });
  revalidatePath(PATH);
}
