import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { syncDatasetEntitlement } from "@/lib/exchange-service/catalog-sync";
import { isEntitledToAny, listEntitlementsForDataProduct } from "@/lib/entitlement-directory";
import { EntitlementStatus } from "@/models";
import type { DataProductDataset } from "@/models";

interface DataProductDatasetDocument extends Omit<DataProductDataset, "id"> {
  _id: string;
}

/**
 * `dataProductDatasets` is the join collection behind the Data Product <->
 * Dataset many-to-many relationship — neither `dataProducts` nor
 * `datasets` documents reference each other directly. Shared catalog
 * content, same as both sides of the join, so lookups here are plain
 * unscoped queries; entitlement filtering happens one layer up.
 */
function toAssociation(doc: DataProductDatasetDocument): DataProductDataset {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

export async function listDatasetIdsForDataProduct(dataProductId: string): Promise<string[]> {
  const db = await getDb();
  const docs = await db
    .collection<DataProductDatasetDocument>("dataProductDatasets")
    .find({ dataProductId })
    .toArray();
  return docs.map((doc) => doc.datasetId);
}

export async function listDataProductIdsForDataset(datasetId: string): Promise<string[]> {
  const db = await getDb();
  const docs = await db
    .collection<DataProductDatasetDocument>("dataProductDatasets")
    .find({ datasetId })
    .toArray();
  return docs.map((doc) => doc.dataProductId);
}

/** Bulk variant of `listDataProductIdsForDataset`, keyed by dataset id. */
export async function listDataProductIdsForDatasets(
  datasetIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (datasetIds.length === 0) {
    return result;
  }
  const db = await getDb();
  const docs = await db
    .collection<DataProductDatasetDocument>("dataProductDatasets")
    .find({ datasetId: { $in: datasetIds } })
    .toArray();
  for (const doc of docs) {
    const existing = result.get(doc.datasetId);
    if (existing) {
      existing.push(doc.dataProductId);
    } else {
      result.set(doc.datasetId, [doc.dataProductId]);
    }
  }
  return result;
}

/** Bulk variant of `listDatasetIdsForDataProduct`, keyed by data product id. */
export async function listDatasetIdsForDataProducts(
  dataProductIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (dataProductIds.length === 0) {
    return result;
  }
  const db = await getDb();
  const docs = await db
    .collection<DataProductDatasetDocument>("dataProductDatasets")
    .find({ dataProductId: { $in: dataProductIds } })
    .toArray();
  for (const doc of docs) {
    const existing = result.get(doc.dataProductId);
    if (existing) {
      existing.push(doc.datasetId);
    } else {
      result.set(doc.dataProductId, [doc.datasetId]);
    }
  }
  return result;
}

/** Admin Console only: the full join table, for the relationship graph's bulk load. */
export async function listAllAssociations(): Promise<DataProductDataset[]> {
  const db = await getDb();
  const docs = await db.collection<DataProductDatasetDocument>("dataProductDatasets").find({}).toArray();
  return docs.map(toAssociation);
}

/**
 * Links a Dataset to a Data Product. Idempotent — granting the same pair
 * twice is a no-op rather than a duplicate row, since the relationship
 * itself has no meaningful multiplicity.
 */
export async function associateDataset(dataProductId: string, datasetId: string): Promise<void> {
  const db = await getDb();
  const collection = db.collection<DataProductDatasetDocument>("dataProductDatasets");
  const existing = await collection.findOne({ dataProductId, datasetId });
  if (existing) {
    return;
  }
  await collection.insertOne({
    _id: `dpd-${randomBytes(4).toString("hex")}`,
    dataProductId,
    datasetId,
    createdAt: new Date().toISOString(),
  });

  // Every tenant already entitled to dataProductId now also gets this
  // dataset — data-exchange-service authorizes at the dataset level (see
  // docs/exchange-service-integration.md "Catalog model mismatch").
  const entitlements = await listEntitlementsForDataProduct(dataProductId);
  await Promise.all(
    entitlements
      .filter((entitlement) => entitlement.status === EntitlementStatus.ACTIVE)
      .map((entitlement) => syncDatasetEntitlement(entitlement.tenantId, datasetId, true)),
  );
}

export async function dissociateDataset(dataProductId: string, datasetId: string): Promise<void> {
  const db = await getDb();
  await db.collection<DataProductDatasetDocument>("dataProductDatasets").deleteOne({ dataProductId, datasetId });

  // A dataset can sit under several Data Products (see module doc above),
  // so losing this one link doesn't necessarily revoke access — only
  // recompute for tenants who were actually entitled via the removed link,
  // against whatever Data Products still remain.
  const [remainingDataProductIds, entitlements] = await Promise.all([
    listDataProductIdsForDataset(datasetId),
    listEntitlementsForDataProduct(dataProductId),
  ]);
  await Promise.all(
    entitlements
      .filter((entitlement) => entitlement.status === EntitlementStatus.ACTIVE)
      .map(async (entitlement) => {
        const stillEntitled = await isEntitledToAny(entitlement.tenantId, remainingDataProductIds);
        await syncDatasetEntitlement(entitlement.tenantId, datasetId, stillEntitled);
      }),
  );
}

/** Removes every association for a Dataset — called when the Dataset itself is deleted. */
export async function dissociateAllForDataset(datasetId: string): Promise<void> {
  const db = await getDb();
  await db.collection<DataProductDatasetDocument>("dataProductDatasets").deleteMany({ datasetId });
}
