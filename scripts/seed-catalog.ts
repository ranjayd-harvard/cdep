import { MongoClient, type Db } from "mongodb";
import { MOCK_ORGANIZATIONS } from "../src/data/mocks/organizations";
import { MOCK_TENANTS } from "../src/data/mocks/tenants";
import { MOCK_DATA_PRODUCTS } from "../src/data/mocks/data-products";
import { MOCK_DATASETS } from "../src/data/mocks/datasets";
import { MOCK_DATA_PRODUCT_DATASETS } from "../src/data/mocks/data-product-datasets";
import { MOCK_ENTITLEMENTS } from "../src/data/mocks/entitlements";
import { ensureValidatedCollection } from "./ensure-collection";

/**
 * Seeds the tenant hierarchy: Organization -> Tenant -> Entitlement ->
 * DataProduct -> Dataset. `entitlements` gets a `$jsonSchema` validator
 * requiring `tenantId`/`dataProductId`/`status` on every document — a
 * document missing its tenant is rejected by MongoDB itself, independent
 * of whatever application code path wrote it. `organizations`/`tenants`/
 * `dataProducts`/`datasets` are shared catalog or profile content, not
 * tenant-owned data, so they don't need that guarantee.
 */
const ENTITLEMENTS_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: ["tenantId", "dataProductId", "status", "grantedAt", "grantedBy"],
    properties: {
      tenantId: {
        bsonType: "string",
        description: "The tenant this grant belongs to — required on every entitlement.",
      },
      dataProductId: { bsonType: "string" },
      status: { enum: ["ACTIVE", "REVOKED", "EXPIRED"] },
    },
  },
};

async function upsertById(db: Db, collectionName: string, records: Array<{ id: string }>): Promise<void> {
  const collection = db.collection<{ _id: string }>(collectionName);
  for (const record of records) {
    const { id, ...fields } = record;
    await collection.updateOne({ _id: id }, { $set: fields }, { upsert: true });
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Run this with --env-file=.env.local (see package.json).");
  }
  const dbName = process.env.MONGO_DATABASE ?? "portal";

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    await upsertById(db, "organizations", MOCK_ORGANIZATIONS);
    await upsertById(db, "tenants", MOCK_TENANTS);
    await upsertById(db, "dataProducts", MOCK_DATA_PRODUCTS);
    await upsertById(db, "datasets", MOCK_DATASETS);
    await upsertById(db, "dataProductDatasets", MOCK_DATA_PRODUCT_DATASETS);

    await ensureValidatedCollection(db, "entitlements", ENTITLEMENTS_VALIDATOR);
    await upsertById(db, "entitlements", MOCK_ENTITLEMENTS);

    console.log(
      `Seeded ${MOCK_ORGANIZATIONS.length} organizations, ${MOCK_TENANTS.length} tenants, ` +
        `${MOCK_DATA_PRODUCTS.length} data products, ${MOCK_DATASETS.length} datasets, ` +
        `${MOCK_DATA_PRODUCT_DATASETS.length} data product/dataset associations, and ` +
        `${MOCK_ENTITLEMENTS.length} entitlements into "${dbName}".`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
