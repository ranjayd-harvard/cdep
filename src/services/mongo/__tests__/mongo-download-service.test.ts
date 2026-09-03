import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoDownloadService } from "@/services/mongo/mongo-download-service";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function seed() {
  const db = createFakeDb({
    downloads: [
      { _id: "dl-a1", tenantId: TENANT_A, datasetId: "ds-a", filename: "a.csv", format: "CSV", generatedAt: "2026-01-01T00:00:00Z", sizeBytes: 10, expiresAt: "2026-02-01T00:00:00Z", storageFileId: "storage-a1" },
      { _id: "dl-b1", tenantId: TENANT_B, datasetId: "ds-b", filename: "b.csv", format: "CSV", generatedAt: "2026-01-02T00:00:00Z", sizeBytes: 20, expiresAt: "2026-02-02T00:00:00Z", storageFileId: "storage-b1" },
    ],
  });
  getDbMock.mockResolvedValue(db);
}

describe("MongoDownloadService", () => {
  it("only returns downloads belonging to the requesting tenant", async () => {
    seed();
    const service = new MongoDownloadService();

    const downloads = await service.getDownloads(TENANT_A);

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.id).toBe("dl-a1");
  });

  it("never leaks the internal GridFS storage id on the public shape", async () => {
    seed();
    const service = new MongoDownloadService();

    const [download] = await service.getDownloads(TENANT_A);

    expect(download).not.toHaveProperty("storageFileId");
    expect(download).not.toHaveProperty("tenantId");
  });

  it("mints a download URL scoped to this file and tenant for an owned file", async () => {
    seed();
    const service = new MongoDownloadService();

    const url = await service.getDownloadUrl(TENANT_A, "dl-a1");

    expect(url).toMatch(/^\/api\/downloads\/dl-a1\/file\?token=[0-9a-f]{64}$/);
  });

  it("refuses to mint a URL for a file belonging to another tenant", async () => {
    seed();
    const service = new MongoDownloadService();

    await expect(service.getDownloadUrl(TENANT_A, "dl-b1")).rejects.toThrow();
  });
});
