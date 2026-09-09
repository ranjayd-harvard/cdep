import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { slugify } from "@/lib/utils";
import { syncOrganization } from "@/lib/exchange-service/catalog-sync";
import type { Organization } from "@/models";

interface OrganizationDocument {
  _id: string;
  name: string;
  displayName: string;
  status: Organization["status"];
}

/**
 * `organizations` holds org profile records, not tenant-owned data — an
 * account belongs to exactly one, but the document itself isn't scoped
 * *by* a tenantId the way an Entitlement is, so a plain lookup by id is
 * enough here; `TenantScopedCollection` doesn't apply.
 */
export async function findOrganizationById(organizationId: string): Promise<Organization | null> {
  const db = await getDb();
  const doc = await db.collection<OrganizationDocument>("organizations").findOne({ _id: organizationId });
  if (!doc) {
    return null;
  }
  return { id: doc._id, name: doc.name, displayName: doc.displayName, status: doc.status };
}

/**
 * Every Organization on the platform — Admin Console only
 * (`src/app/admin/organizations`). Unlike `searchOrganizationsByName`,
 * this is deliberately unbounded: the Admin Console is the one place a
 * caller is allowed to see every customer at once.
 */
export async function listOrganizations(): Promise<Organization[]> {
  const db = await getDb();
  const docs = await db.collection<OrganizationDocument>("organizations").find({}).toArray();
  return docs.map((doc) => ({ id: doc._id, name: doc.name, displayName: doc.displayName, status: doc.status }));
}

/**
 * Admin Console only: activates/deactivates an Organization. Doesn't
 * cascade to its Tenants or members — those are toggled independently.
 */
export async function setOrganizationStatus(
  organizationId: string,
  status: Organization["status"],
): Promise<void> {
  const db = await getDb();
  await db
    .collection<OrganizationDocument>("organizations")
    .updateOne({ _id: organizationId }, { $set: { status } });
}

/**
 * Case-insensitive search over organization name/display name, used by
 * the onboarding "find your org" step (see `src/app/(auth)/onboarding`).
 * Capped so a broad query can't return an unbounded result set.
 */
export async function searchOrganizationsByName(query: string): Promise<Organization[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const db = await getDb();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const docs = await db
    .collection<OrganizationDocument>("organizations")
    .find({ $or: [{ name: pattern }, { displayName: pattern }] })
    .limit(10)
    .toArray();

  return docs.map((doc) => ({ id: doc._id, name: doc.name, displayName: doc.displayName, status: doc.status }));
}

/**
 * Provisions a brand-new organization, either from the onboarding
 * "create a new organization" step or a first-time Google login (see
 * `src/app/(auth)/onboarding` and `src/auth.ts`). The id just needs to be
 * unique, not meaningful.
 */
export async function createOrganization(input: { displayName: string }): Promise<Organization> {
  const db = await getDb();
  const doc: OrganizationDocument = {
    _id: `org-${slugify(input.displayName) || "organization"}-${randomBytes(3).toString("hex")}`,
    name: slugify(input.displayName),
    displayName: input.displayName,
    status: "active",
  };
  await db.collection<OrganizationDocument>("organizations").insertOne(doc);
  await syncOrganization(doc._id, doc.displayName);
  return { id: doc._id, name: doc.name, displayName: doc.displayName, status: doc.status };
}
