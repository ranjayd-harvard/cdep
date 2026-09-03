"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/lib/tenant";
import { canManageSettings } from "@/lib/authorization";
import { services } from "@/services";

export interface CreateApiKeyState {
  error?: string;
  createdSecret?: string;
  createdLabel?: string;
}

/**
 * Admin-only: issues a new API key for the caller's tenant. The raw
 * secret comes back in the returned state for one-time display — it is
 * never persisted or retrievable again after this call returns.
 */
export async function createApiKeyAction(
  _prevState: CreateApiKeyState,
  formData: FormData,
): Promise<CreateApiKeyState> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    return { error: "Only an organization admin can create API keys." };
  }

  const label = String(formData.get("label") ?? "").trim();
  if (!label) {
    return { error: "A label is required." };
  }

  const { credential, secret } = await services.apiAccess.createApiKey(tenant.tenantId, label, tenant.email);
  revalidatePath("/api-access");
  return { createdSecret: secret, createdLabel: credential.label };
}

/**
 * Admin-only: revokes one of the caller's own tenant's API keys.
 * Scoped by construction — `revokeApiKey` writes through a
 * `TenantScopedCollection`, so a keyId belonging to another tenant simply
 * won't match and no-ops, the same way `setEntitlementStatus` does.
 */
export async function revokeApiKeyAction(keyId: string): Promise<void> {
  const tenant = await requireTenantContext();
  if (!canManageSettings(tenant.role)) {
    throw new Error("Only an organization admin can revoke API keys.");
  }

  await services.apiAccess.revokeApiKey(tenant.tenantId, keyId);
  revalidatePath("/api-access");
}
