import { getDb } from "@/lib/mongodb";
import type { DataProduct } from "@/models";

interface DataProductDocument {
  _id: string;
  name: string;
  displayName: string;
  description: string;
  domain: string;
  owner: string;
  status: DataProduct["status"];
  datasetIds: string[];
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
    datasetIds: doc.datasetIds,
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
