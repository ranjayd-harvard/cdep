import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { slugify } from "@/lib/utils";
import { syncDataProduct } from "@/lib/exchange-service/catalog-sync";
import type { Dataset } from "@/models";

interface DatasetDocument extends Omit<Dataset, "id"> {
  _id: string;
}

/**
 * `datasets` is shared catalog content, same as `dataProducts` — see
 * `src/lib/data-product-directory.ts`. Which Data Product(s) a Dataset
 * belongs to lives in `src/lib/data-product-dataset-directory.ts`, not on
 * this document. Entitlement filtering happens one layer up, in
 * `src/services/mongo`, before these results ever reach a caller.
 */
function toDataset(doc: DatasetDocument): Dataset {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

export async function findDatasetById(datasetId: string): Promise<Dataset | null> {
  const db = await getDb();
  const doc = await db.collection<DatasetDocument>("datasets").findOne({ _id: datasetId });
  return doc ? toDataset(doc) : null;
}

export async function findDatasetsByIds(datasetIds: string[]): Promise<Dataset[]> {
  if (datasetIds.length === 0) {
    return [];
  }
  const db = await getDb();
  const docs = await db
    .collection<DatasetDocument>("datasets")
    .find({ _id: { $in: datasetIds } })
    .toArray();
  return docs.map(toDataset);
}

/** Admin Console only: the full catalog, unfiltered by any tenant's entitlements. */
export async function listDatasets(): Promise<Dataset[]> {
  const db = await getDb();
  const docs = await db.collection<DatasetDocument>("datasets").find({}).toArray();
  return docs.map(toDataset);
}

/**
 * Admin Console only: case-insensitive search over dataset name/display
 * name — same convention as `searchOrganizationsByName`
 * (`src/lib/organization-directory.ts`), capped so a broad query can't
 * return an unbounded result set.
 */
export async function searchDatasetsByName(query: string): Promise<Dataset[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const db = await getDb();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const docs = await db
    .collection<DatasetDocument>("datasets")
    .find({ $or: [{ name: pattern }, { displayName: pattern }] })
    .limit(10)
    .toArray();

  return docs.map(toDataset);
}

export type DatasetFields = Omit<Dataset, "id">;

/**
 * Admin Console only (`src/app/admin/data-products/[dataProductId]`):
 * adds a new Dataset to the catalog. The id just needs to be unique, not
 * meaningful, same as `createDataProduct` (`src/lib/data-product-directory.ts`).
 * Callers associate it with a Data Product separately, via
 * `associateDataset` (`src/lib/data-product-dataset-directory.ts`).
 */
export async function createDataset(input: DatasetFields): Promise<Dataset> {
  const db = await getDb();
  const doc: DatasetDocument = {
    _id: `ds-${slugify(input.displayName) || "dataset"}-${randomBytes(3).toString("hex")}`,
    ...input,
  };
  await db.collection<DatasetDocument>("datasets").insertOne(doc);
  await syncDataProduct(doc._id, doc.displayName, doc.description, doc.version);
  return toDataset(doc);
}

/** Admin Console only: edits an existing Dataset in place. */
export async function updateDataset(datasetId: string, input: DatasetFields): Promise<Dataset | null> {
  const db = await getDb();
  await db.collection<DatasetDocument>("datasets").updateOne({ _id: datasetId }, { $set: input });
  await syncDataProduct(datasetId, input.displayName, input.description, input.version);
  return findDatasetById(datasetId);
}

/** Admin Console only: removes a Dataset entirely. */
export async function deleteDataset(datasetId: string): Promise<void> {
  const db = await getDb();
  await db.collection<DatasetDocument>("datasets").deleteOne({ _id: datasetId });
}
