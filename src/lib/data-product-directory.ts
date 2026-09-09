import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { slugify } from "@/lib/utils";
import type { DataProduct } from "@/models";

interface DataProductDocument {
  _id: string;
  name: string;
  displayName: string;
  description: string;
  domain: string;
  owner: string;
  status: DataProduct["status"];
}

/**
 * `dataProducts` is shared catalog content — the same document is
 * visible to every tenant that's entitled to it — so lookups here are
 * plain id queries. Entitlement filtering happens one layer up, in the
 * Mongo-backed services (`src/services/mongo`), before these results
 * ever reach a caller.
 */
function toDataProduct(doc: DataProductDocument): DataProduct {
  return {
    id: doc._id,
    name: doc.name,
    displayName: doc.displayName,
    description: doc.description,
    domain: doc.domain,
    owner: doc.owner,
    status: doc.status,
  };
}

export async function findDataProductById(dataProductId: string): Promise<DataProduct | null> {
  const db = await getDb();
  const doc = await db.collection<DataProductDocument>("dataProducts").findOne({ _id: dataProductId });
  return doc ? toDataProduct(doc) : null;
}

export async function findDataProductsByIds(dataProductIds: string[]): Promise<DataProduct[]> {
  if (dataProductIds.length === 0) {
    return [];
  }
  const db = await getDb();
  const docs = await db
    .collection<DataProductDocument>("dataProducts")
    .find({ _id: { $in: dataProductIds } })
    .toArray();
  return docs.map(toDataProduct);
}

/**
 * The full catalog, unfiltered by any tenant's entitlements. For admin
 * surfaces (granting entitlements) that need to pick from every data
 * product that exists, not just the ones a given tenant can already see.
 */
export async function listDataProducts(): Promise<DataProduct[]> {
  const db = await getDb();
  const docs = await db.collection<DataProductDocument>("dataProducts").find({}).toArray();
  return docs.map(toDataProduct);
}

/**
 * Admin Console only (`src/app/admin/data-products`): provisions a new
 * catalog entry. The id just needs to be unique, not meaningful, same as
 * `createOrganization` (`src/lib/organization-directory.ts`).
 */
export async function createDataProduct(input: {
  name: string;
  displayName: string;
  description: string;
  domain: string;
  owner: string;
  status: DataProduct["status"];
}): Promise<DataProduct> {
  const db = await getDb();
  const doc: DataProductDocument = {
    _id: `dp-${slugify(input.displayName) || "product"}-${randomBytes(3).toString("hex")}`,
    name: input.name,
    displayName: input.displayName,
    description: input.description,
    domain: input.domain,
    owner: input.owner,
    status: input.status,
  };
  await db.collection<DataProductDocument>("dataProducts").insertOne(doc);
  return toDataProduct(doc);
}

/**
 * Admin Console only: case-insensitive search over data product
 * name/display name — same convention as `searchOrganizationsByName`
 * (`src/lib/organization-directory.ts`), capped so a broad query can't
 * return an unbounded result set.
 */
export async function searchDataProductsByName(query: string): Promise<DataProduct[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const db = await getDb();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const docs = await db
    .collection<DataProductDocument>("dataProducts")
    .find({ $or: [{ name: pattern }, { displayName: pattern }] })
    .limit(10)
    .toArray();

  return docs.map(toDataProduct);
}

/**
 * Admin Console only: edits an existing catalog entry in place. The id
 * itself is never editable — callers that need a different id create a
 * new entry instead.
 */
export async function updateDataProduct(
  dataProductId: string,
  input: {
    name: string;
    displayName: string;
    description: string;
    domain: string;
    owner: string;
    status: DataProduct["status"];
  },
): Promise<DataProduct | null> {
  const db = await getDb();
  await db.collection<DataProductDocument>("dataProducts").updateOne({ _id: dataProductId }, { $set: input });
  return findDataProductById(dataProductId);
}

/**
 * Admin Console only: removes a catalog entry entirely. Doesn't cascade
 * to Entitlements that grant it — those are left dangling, the same way
 * `setOrganizationStatus` doesn't cascade to an org's Tenants/members.
 */
export async function deleteDataProduct(dataProductId: string): Promise<void> {
  const db = await getDb();
  await db.collection<DataProductDocument>("dataProducts").deleteOne({ _id: dataProductId });
}
