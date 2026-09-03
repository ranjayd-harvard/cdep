import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoDataProductService } from "@/services/mongo/mongo-data-product-service";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function seed() {
  const db = createFakeDb({
    entitlements: [{ tenantId: TENANT_A, dataProductId: "dp-a", status: "ACTIVE" }],
    dataProducts: [
      { _id: "dp-a", displayName: "A's product", datasetIds: [] },
      { _id: "dp-b", displayName: "B's product", datasetIds: [] },
    ],
  });
  getDbMock.mockResolvedValue(db);
}

describe("MongoDataProductService", () => {
  it("only returns data products the tenant is entitled to", async () => {
    seed();
    const service = new MongoDataProductService();

    const dataProducts = await service.getDataProducts(TENANT_A);

    expect(dataProducts).toHaveLength(1);
    expect(dataProducts[0]?.id).toBe("dp-a");
  });

  it("returns null for a data product that exists but isn't entitled to this tenant", async () => {
    seed();
    const service = new MongoDataProductService();

    const dataProduct = await service.getDataProduct(TENANT_A, "dp-b");

    expect(dataProduct).toBeNull();
  });

  it("returns an empty list for a tenant with no entitlements", async () => {
    seed();
    const service = new MongoDataProductService();

    const dataProducts = await service.getDataProducts(TENANT_B);

    expect(dataProducts).toEqual([]);
  });
});
