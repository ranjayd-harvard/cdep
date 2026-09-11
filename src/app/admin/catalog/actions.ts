"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import type { AdminActionResult } from "@/services/interfaces";

function flashRedirect(productId: string, result: AdminActionResult, successMessage: string): never {
  const params = new URLSearchParams({ productId });
  if (result.ok) {
    params.set("actionSuccess", successMessage);
  } else {
    params.set("actionError", result.errorMessage ?? result.errorCode ?? "Action failed.");
    if (result.blockers && result.blockers.length > 0) {
      params.set("actionBlockers", result.blockers.map((b) => `${b.type}: ${b.detail}`).join(" | "));
    }
  }
  revalidatePath("/admin/catalog");
  redirect(`/admin/catalog?${params.toString()}`);
}

export async function activateVersionAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const version = String(formData.get("version") ?? "");
  const targetStatus = (formData.get("targetStatus") === "BETA" ? "BETA" : "ACTIVE") as "ACTIVE" | "BETA";
  const result = await services.productVersioningAdmin.activateVersion(productId, version, targetStatus, admin.email);
  flashRedirect(productId, result, `${version} → ${targetStatus}`);
}

export async function deprecateVersionAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const version = String(formData.get("version") ?? "");
  const reason = String(formData.get("reason") ?? "") || undefined;
  const gracePeriodDaysRaw = String(formData.get("gracePeriodDays") ?? "");
  const gracePeriodDays = gracePeriodDaysRaw ? Number(gracePeriodDaysRaw) : undefined;
  const replacementVersion = String(formData.get("replacementVersion") ?? "") || undefined;
  const result = await services.productVersioningAdmin.deprecateVersion(
    productId,
    version,
    { reason, gracePeriodDays, replacementVersion },
    admin.email,
  );
  flashRedirect(productId, result, `${version} deprecated`);
}

export async function retireVersionAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const version = String(formData.get("version") ?? "");
  const reason = String(formData.get("reason") ?? "") || undefined;
  const force = formData.get("force") === "on";
  const result = await services.productVersioningAdmin.retireVersion(productId, version, { reason, force }, admin.email);
  flashRedirect(productId, result, `${version} retired`);
}

export async function rollbackVersionAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const version = String(formData.get("version") ?? "");
  const reason = String(formData.get("reason") ?? "") || undefined;
  const result = await services.productVersioningAdmin.rollbackVersion(productId, version, reason, admin.email);
  flashRedirect(productId, result, `rolled back to ${version}`);
}

export async function approveVersionAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const version = String(formData.get("version") ?? "");
  const reason = String(formData.get("reason") ?? "") || undefined;
  const result = await services.productVersioningAdmin.approveVersion(productId, version, reason, admin.email);
  flashRedirect(productId, result, `${version} approved`);
}

export async function grantBetaOptInAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const version = String(formData.get("version") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");
  const result = await services.productVersioningAdmin.grantBetaOptIn(productId, version, { organizationId, tenantId }, admin.email);
  flashRedirect(productId, result, `${tenantId} opted into ${version}`);
}

export async function createMigrationAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const toVersion = String(formData.get("toVersion") ?? "");
  const reason = String(formData.get("reason") ?? "") || undefined;
  const result = await services.productVersioningAdmin.createMigration(productId, { toVersion, reason }, admin.email);
  flashRedirect(
    productId,
    result,
    result.ok ? `migration plan created (${result.affectedSubscriptions ?? 0} subscription(s) affected)` : "",
  );
}

export async function executeMigrationAction(formData: FormData): Promise<void> {
  const admin = await requireSuperuserContext();
  const productId = String(formData.get("productId") ?? "");
  const migrationId = String(formData.get("migrationId") ?? "");
  const result = await services.productVersioningAdmin.executeMigration(productId, migrationId, admin.email);
  flashRedirect(productId, result, "migration executed");
}
