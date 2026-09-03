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
 * Grants a tenant access to a data product. Writes go through the same
 * `TenantScopedCollection` as the reads above, so an entitlement can
 * never be created under a `tenantId` other than the one this call was
 * made for.
 */
export async function createEntitlement(
  tenantId: string,
  dataProductId: string,
  grantedBy: string,
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
    expiresAt: null,
  };
  await entitlements.insertOne(doc);
  return toEntitlement(doc);
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
