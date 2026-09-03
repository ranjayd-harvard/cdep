import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoDatasetService } from "@/services/mongo/mongo-dataset-service";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function seed() {
  const db = createFakeDb({
    entitlements: [
      { tenantId: TENANT_A, dataProductId: "dp-a", status: "ACTIVE" },
      { tenantId: TENANT_B, dataProductId: "dp-b", status: "ACTIVE" },
    ],
    datasets: [
      { _id: "ds-a", dataProductId: "dp-a", displayName: "A-only dataset" },
      { _id: "ds-b", dataProductId: "dp-b", displayName: "B-only dataset" },
    ],
  });
  getDbMock.mockResolvedValue(db);
}

describe("MongoDatasetService", () => {
  it("only returns datasets belonging to data products the tenant is entitled to", async () => {
    seed();
    const service = new MongoDatasetService();

    const datasets = await service.getDatasets(TENANT_A);

    expect(datasets).toHaveLength(1);
    expect(datasets[0]?.id).toBe("ds-a");
  });

  it("returns null for a dataset that exists but belongs to another tenant's entitlement", async () => {
    seed();
    const service = new MongoDatasetService();

    // Tenant A knows Tenant B's exact dataset id, e.g. by guessing a
    // sequential/crafted id. It must still come back as not-found.
    const dataset = await service.getDataset(TENANT_A, "ds-b");

    expect(dataset).toBeNull();
  });

  it("returns the dataset for the tenant it actually belongs to", async () => {
    seed();
    const service = new MongoDatasetService();

    const dataset = await service.getDataset(TENANT_B, "ds-b");

    expect(dataset?.id).toBe("ds-b");
  });

  it("returns null for a dataset id that doesn't exist at all", async () => {
    seed();
    const service = new MongoDatasetService();

    const dataset = await service.getDataset(TENANT_A, "ds-does-not-exist");

    expect(dataset).toBeNull();
  });
});
