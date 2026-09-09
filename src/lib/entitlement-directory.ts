import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { getTenantScopedCollection, type TenantOwnedDocument } from "@/lib/tenant-scoped-collection";
import { EntitlementStatus, type Entitlement } from "@/models";

interface EntitlementDocument extends TenantOwnedDocument {
  _id: string;
  dataProductId: string;
  status: Entitlement["status"];
  grantedAt: string;
  grantedBy: string;
  expiresAt: string | null;
}

/**
 * The authoritative source of "which data products can this tenant
 * see." Every read goes through a `TenantScopedCollection`, so there is
 * no code path here that can return another tenant's grants — not
 * because this function remembers to filter, but because the collection
 * it holds structurally cannot.
 */
function toEntitlement(doc: EntitlementDocument): Entitlement {
  return {
    id: doc._id,
    tenantId: doc.tenantId,
    dataProductId: doc.dataProductId,
    status: doc.status,
    grantedAt: doc.grantedAt,
    grantedBy: doc.grantedBy,
    expiresAt: doc.expiresAt,
  };
}

export async function getEntitlements(tenantId: string): Promise<Entitlement[]> {
  const db = await getDb();
  const entitlements = getTenantScopedCollection<EntitlementDocument>(db, "entitlements", tenantId);
  const docs = await entitlements.find().toArray();
  return docs.map(toEntitlement);
}

/**
 * Admin Console only: every Entitlement across every tenant that grants
 * access to one Data Product — "which tenants can see this product, and
 * why." Deliberately bypasses `TenantScopedCollection` (there is no
 * single tenant to scope to here), the same way `listAllDataProducts`
 * bypasses per-tenant entitlement filtering for the catalog.
 */
export async function listEntitlementsForDataProduct(dataProductId: string): Promise<Entitlement[]> {
  const db = await getDb();
  const docs = await db.collection<EntitlementDocument>("entitlements").find({ dataProductId }).toArray();
  return docs.map(toEntitlement);
}

export async function getEntitledDataProductIds(tenantId: string): Promise<string[]> {
  const db = await getDb();
  const entitlements = getTenantScopedCollection<EntitlementDocument>(db, "entitlements", tenantId);
  const docs = await entitlements.find({ status: EntitlementStatus.ACTIVE }).toArray();
  return docs.map((doc) => doc.dataProductId);
}

export async function isEntitled(tenantId: string, dataProductId: string): Promise<boolean> {
  const db = await getDb();
  const entitlements = getTenantScopedCollection<EntitlementDocument>(db, "entitlements", tenantId);
  const doc = await entitlements.findOne({ dataProductId, status: EntitlementStatus.ACTIVE });
  return doc !== null;
}

/**
 * A Dataset can belong to several Data Products (see
 * `src/lib/data-product-dataset-directory.ts`), so visibility is "entitled
 * to at least one of them" rather than a single id check.
 */
export async function isEntitledToAny(tenantId: string, dataProductIds: string[]): Promise<boolean> {
  if (dataProductIds.length === 0) {
    return false;
  }
  const db = await getDb();
  const entitlements = getTenantScopedCollection<EntitlementDocument>(db, "entitlements", tenantId);
  const doc = await entitlements.findOne({
    dataProductId: { $in: dataProductIds },
    status: EntitlementStatus.ACTIVE,
  });
  return doc !== null;
}

/**
 * Grants a tenant access to a data product. Writes go through the same
 * `TenantScopedCollection` as the reads above, so an entitlement can
 * never be created under a `tenantId` other than the one this call was
 * made for.
 */
export async function createEntitlement(
  tenantId: string,
  dataProductId: string,
  grantedBy: string,
  expiresAt: string | null = null,
): Promise<Entitlement> {
  const db = await getDb();
  const entitlements = getTenantScopedCollection<EntitlementDocument>(db, "entitlements", tenantId);
  const doc: EntitlementDocument = {
    _id: `ent-${randomBytes(4).toString("hex")}`,
    tenantId,
    dataProductId,
    status: EntitlementStatus.ACTIVE,
    grantedAt: new Date().toISOString(),
    grantedBy,
    expiresAt,
  };
  await entitlements.insertOne(doc);
  return toEntitlement(doc);
}

/** Edits an existing Entitlement's expiration date without changing its status. */
export async function setEntitlementExpiry(
  tenantId: string,
  entitlementId: string,
  expiresAt: string | null,
): Promise<void> {
  const db = await getDb();
  const entitlements = getTenantScopedCollection<EntitlementDocument>(db, "entitlements", tenantId);
  await entitlements.updateOne({ _id: entitlementId }, { $set: { expiresAt } });
}

/**
 * Revokes or reactivates an existing entitlement in place — entitlements
 * keep their history rather than being deleted, matching the
 * `ACTIVE | REVOKED | EXPIRED` status model.
 */
export async function setEntitlementStatus(
  tenantId: string,
  entitlementId: string,
  status: EntitlementStatus,
): Promise<void> {
  const db = await getDb();
  const entitlements = getTenantScopedCollection<EntitlementDocument>(db, "entitlements", tenantId);
  await entitlements.updateOne({ _id: entitlementId }, { $set: { status } });
}
