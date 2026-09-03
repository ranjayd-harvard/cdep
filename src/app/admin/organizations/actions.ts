"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import type { Organization } from "@/models";

/**
 * Admin Console only: activates/deactivates an Organization. Doesn't
 * cascade to its Tenants or members — those are toggled independently
 * from the org detail page (`[organizationId]/actions.ts`).
 */
export async function setOrganizationStatus(organizationId: string, status: Organization["status"]): Promise<void> {
  await requireSuperuserContext();
  await services.organizations.setOrganizationStatus(organizationId, status);
  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${organizationId}`);
}
