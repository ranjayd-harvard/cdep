import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import {
  associateDataset,
  dissociateAllForDataset,
  dissociateDataset,
  listAllAssociations,
  listDataProductIdsForDataset,
  listDataProductIdsForDatasets,
  listDatasetIdsForDataProduct,
  listDatasetIdsForDataProducts,
} from "@/lib/data-product-dataset-directory";

function seed(rows: Array<{ _id: string; dataProductId: string; datasetId: string }> = []) {
  const db = createFakeDb({ dataProductDatasets: rows });
  getDbMock.mockResolvedValue(db);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("data-product-dataset-directory", () => {
  it("lists dataset ids for a data product", async () => {
    seed([
      { _id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-1" },
      { _id: "dpd-2", dataProductId: "dp-a", datasetId: "ds-2" },
      { _id: "dpd-3", dataProductId: "dp-b", datasetId: "ds-3" },
    ]);

    expect(await listDatasetIdsForDataProduct("dp-a")).toEqual(["ds-1", "ds-2"]);
  });

  it("lists data product ids for a dataset shared across several products", async () => {
    seed([
      { _id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-shared" },
      { _id: "dpd-2", dataProductId: "dp-b", datasetId: "ds-shared" },
    ]);

    expect(await listDataProductIdsForDataset("ds-shared")).toEqual(["dp-a", "dp-b"]);
  });

  it("bulk-resolves data product ids for several datasets", async () => {
    seed([
      { _id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-1" },
      { _id: "dpd-2", dataProductId: "dp-b", datasetId: "ds-1" },
      { _id: "dpd-3", dataProductId: "dp-a", datasetId: "ds-2" },
    ]);

    const result = await listDataProductIdsForDatasets(["ds-1", "ds-2"]);

    expect(result.get("ds-1")?.sort()).toEqual(["dp-a", "dp-b"]);
    expect(result.get("ds-2")).toEqual(["dp-a"]);
  });

  it("bulk-resolves dataset ids for several data products", async () => {
    seed([
      { _id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-1" },
      { _id: "dpd-2", dataProductId: "dp-b", datasetId: "ds-2" },
    ]);

    const result = await listDatasetIdsForDataProducts(["dp-a", "dp-b"]);

    expect(result.get("dp-a")).toEqual(["ds-1"]);
    expect(result.get("dp-b")).toEqual(["ds-2"]);
  });

  it("lists every association in the join table", async () => {
    seed([
      { _id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-1" },
      { _id: "dpd-2", dataProductId: "dp-b", datasetId: "ds-2" },
    ]);

    const associations = await listAllAssociations();

    expect(associations).toHaveLength(2);
    expect(associations[0]).toMatchObject({ id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-1" });
  });

  it("associates a dataset with a data product", async () => {
    const db = seed();

    await associateDataset("dp-a", "ds-1");

    expect(await listDatasetIdsForDataProduct("dp-a")).toEqual(["ds-1"]);
    void db;
  });

  it("is idempotent — associating the same pair twice does not duplicate the row", async () => {
    seed();

    await associateDataset("dp-a", "ds-1");
    await associateDataset("dp-a", "ds-1");

    const associations = await listAllAssociations();
    expect(associations).toHaveLength(1);
  });

  it("dissociates a single data product/dataset pair without touching others", async () => {
    seed([
      { _id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-shared" },
      { _id: "dpd-2", dataProductId: "dp-b", datasetId: "ds-shared" },
    ]);

    await dissociateDataset("dp-a", "ds-shared");

    expect(await listDataProductIdsForDataset("ds-shared")).toEqual(["dp-b"]);
  });

  it("removes every association for a dataset when it is deleted", async () => {
    seed([
      { _id: "dpd-1", dataProductId: "dp-a", datasetId: "ds-1" },
      { _id: "dpd-2", dataProductId: "dp-b", datasetId: "ds-1" },
      { _id: "dpd-3", dataProductId: "dp-a", datasetId: "ds-2" },
    ]);

    await dissociateAllForDataset("ds-1");

    const associations = await listAllAssociations();
    expect(associations).toHaveLength(1);
    expect(associations[0]?.datasetId).toBe("ds-2");
  });
});
