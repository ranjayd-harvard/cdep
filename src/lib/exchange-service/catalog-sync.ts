import { env } from "@/config/env";
import { UserRole } from "@/models";
import { pushDataProduct, pushEntitlement, pushMembership, pushOrganization, pushTenant } from "./client";

/**
 * Best-effort, real-time push of cdep catalog writes into
 * data-exchange-service's own Postgres catalog — see
 * `docs/exchange-service-integration.md` § "Keeping catalogs in sync".
 * Callers (the `src/lib/*-directory.ts` write functions) call these right
 * after their own Mongo write succeeds, awaited but never allowed to fail
 * the caller's operation: a push failure here means the two catalogs
 * drift until the next `npm run sync:cdep` (data-exchange-service)
 * reconciliation run — logged loudly so that's visible, not silently
 * swallowed.
 *
 * Deliberately a leaf module: it only imports the exchange-service HTTP
 * client, never another `*-directory.ts` file. Every directory file is
 * free to import this one to push after its own write; if this module
 * imported them back (e.g. to resolve a data product's dataset ids
 * itself) that would create an import cycle, since this is called *from*
 * those same files. Callers resolve whatever fanout they need (dataset
 * ids under a data product, tenants entitled to a data product, ...)
 * themselves, using the directories they already depend on, and pass the
 * resolved ids in.
 */

const ELIGIBLE_MEMBERSHIP_ROLES: readonly string[] = [
  UserRole.CUSTOMER_ADMIN,
  UserRole.CUSTOMER_USER,
  UserRole.CUSTOMER_READONLY,
];

function isConfigured(): boolean {
  return env.exchangeServiceEnabled && Boolean(env.exchangeServiceInternalApiKey);
}

async function pushBestEffort(label: string, push: () => Promise<void>): Promise<void> {
  if (!isConfigured()) return;
  try {
    await push();
  } catch (err) {
    console.warn(`[catalog-sync] ${label} failed (non-fatal — will be fixed by the next sync:cdep run):`, err);
  }
}

export function syncOrganization(organizationId: string, displayName: string): Promise<void> {
  return pushBestEffort(`organization ${organizationId}`, () => pushOrganization(organizationId, displayName));
}

export function syncTenant(tenantId: string, organizationId: string, displayName: string): Promise<void> {
  return pushBestEffort(`tenant ${tenantId}`, () => pushTenant(tenantId, organizationId, displayName));
}

/** No-ops for roles data-exchange-service's catalog doesn't model (e.g. SUPERUSER) — mirrors sync-cdep-catalog.ts's own role filter. */
export function syncMembership(
  userId: string,
  organizationId: string | null,
  tenantId: string | null,
  role: string | null,
): Promise<void> {
  if (!organizationId || !tenantId || !role || !ELIGIBLE_MEMBERSHIP_ROLES.includes(role)) {
    return Promise.resolve();
  }
  return pushBestEffort(`membership ${userId}`, () => pushMembership(userId, organizationId, tenantId, role));
}

/** `datasetId` becomes the data-exchange-service data product id — see "Catalog model mismatch" in the integration doc. */
export function syncDataProduct(
  datasetId: string,
  name: string,
  description: string,
  currentSchemaVersion: string,
): Promise<void> {
  return pushBestEffort(`data product ${datasetId}`, () =>
    pushDataProduct(datasetId, name, description, currentSchemaVersion),
  );
}

export function syncDatasetEntitlement(tenantId: string, datasetId: string, entitled: boolean): Promise<void> {
  return pushBestEffort(`entitlement ${tenantId}/${datasetId}`, () =>
    pushEntitlement(tenantId, datasetId, entitled, entitled),
  );
}

/** Fans a single tenant's entitlement decision out across every dataset under the data product it was actually granted at. */
export async function syncDatasetEntitlementsForTenant(
  tenantId: string,
  datasetIds: string[],
  entitled: boolean,
): Promise<void> {
  await Promise.all(datasetIds.map((datasetId) => syncDatasetEntitlement(tenantId, datasetId, entitled)));
}
