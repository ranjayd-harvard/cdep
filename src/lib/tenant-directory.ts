import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { slugify } from "@/lib/utils";
import { syncTenant } from "@/lib/exchange-service/catalog-sync";
import type { Tenant } from "@/models";

interface TenantDocument {
  _id: string;
  organizationId: string;
  name: string;
  displayName: string;
  isDefault: boolean;
  status: Tenant["status"];
}

function toTenant(doc: TenantDocument): Tenant {
  return {
    id: doc._id,
    organizationId: doc.organizationId,
    name: doc.name,
    displayName: doc.displayName,
    isDefault: doc.isDefault,
    status: doc.status,
  };
}

export async function findTenantById(tenantId: string): Promise<Tenant | null> {
  const db = await getDb();
  const doc = await db.collection<TenantDocument>("tenants").findOne({ _id: tenantId });
  return doc ? toTenant(doc) : null;
}

export async function listTenantsByOrganization(organizationId: string): Promise<Tenant[]> {
  const db = await getDb();
  const docs = await db.collection<TenantDocument>("tenants").find({ organizationId }).toArray();
  return docs.map(toTenant);
}

export async function findTenantsByIds(tenantIds: string[]): Promise<Tenant[]> {
  if (tenantIds.length === 0) {
    return [];
  }
  const db = await getDb();
  const docs = await db.collection<TenantDocument>("tenants").find({ _id: { $in: tenantIds } }).toArray();
  return docs.map(toTenant);
}

/**
 * Admin Console only: case-insensitive search over tenant name/display
 * name across every organization — same convention as
 * `searchOrganizationsByName` (`src/lib/organization-directory.ts`),
 * capped so a broad query can't return an unbounded result set.
 */
export async function searchTenantsByName(query: string): Promise<Tenant[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const db = await getDb();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const docs = await db
    .collection<TenantDocument>("tenants")
    .find({ $or: [{ name: pattern }, { displayName: pattern }] })
    .limit(10)
    .toArray();

  return docs.map(toTenant);
}

export async function findDefaultTenantForOrganization(organizationId: string): Promise<Tenant | null> {
  const db = await getDb();
  const doc = await db.collection<TenantDocument>("tenants").findOne({ organizationId, isDefault: true });
  return doc ? toTenant(doc) : null;
}

/**
 * Creates a Tenant — the actual data-scoping unit (see
 * `src/lib/tenant-scoped-collection.ts`) — under an Organization. Every
 * organization gets exactly one `isDefault: true` tenant at creation time
 * (see `createOrganizationWithAdmin` in
 * `src/app/admin/organizations/actions.ts`); a CUSTOMER_ADMIN can create
 * additional, non-default tenants later from Settings.
 */
export async function createTenant(input: {
  organizationId: string;
  displayName: string;
  isDefault: boolean;
}): Promise<Tenant> {
  const db = await getDb();
  const doc: TenantDocument = {
    _id: `tenant-${slugify(input.displayName) || "tenant"}-${randomBytes(3).toString("hex")}`,
    organizationId: input.organizationId,
    name: slugify(input.displayName),
    displayName: input.displayName,
    isDefault: input.isDefault,
    status: "active",
  };
  await db.collection<TenantDocument>("tenants").insertOne(doc);
  await syncTenant(doc._id, doc.organizationId, doc.displayName);
  return toTenant(doc);
}

/**
 * Moves the `isDefault` flag to a different tenant within the same
 * organization — used when an admin picks a new default (see
 * `src/app/(portal)/settings/tenant-actions.ts`). The org's default
 * tenant is what a join request is assigned to on approval (see
 * `src/app/(portal)/settings/membership-actions.ts`), so this only
 * changes where *future* approvals land, not any existing user's
 * `tenantId`.
 */
export async function setDefaultTenant(organizationId: string, tenantId: string): Promise<void> {
  const db = await getDb();
  const collection = db.collection<TenantDocument>("tenants");
  await collection.updateMany({ organizationId, isDefault: true }, { $set: { isDefault: false } });
  await collection.updateOne({ _id: tenantId, organizationId }, { $set: { isDefault: true } });
}

/**
 * Admin Console only (`src/app/admin/organizations/[organizationId]`):
 * activates/deactivates a single Tenant.
 */
export async function setTenantStatus(tenantId: string, status: Tenant["status"]): Promise<void> {
  const db = await getDb();
  await db.collection<TenantDocument>("tenants").updateOne({ _id: tenantId }, { $set: { status } });
}
