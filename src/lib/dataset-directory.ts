import { getDb } from "@/lib/mongodb";
import type { Dataset } from "@/models";

interface DatasetDocument extends Omit<Dataset, "id"> {
  _id: string;
}

/**
 * `datasets` is shared catalog content, same as `dataProducts` — see
 * `src/lib/data-product-directory.ts`. Entitlement filtering happens one
 * layer up, in `src/services/mongo`, before these results ever reach a
 * caller.
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

export async function findDatasetsByDataProductIds(dataProductIds: string[]): Promise<Dataset[]> {
  if (dataProductIds.length === 0) {
    return [];
  }
  const db = await getDb();
  const docs = await db
    .collection<DatasetDocument>("datasets")
    .find({ dataProductId: { $in: dataProductIds } })
    .toArray();
  return docs.map(toDataset);
}
