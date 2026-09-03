import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock, storeFileMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  storeFileMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

// GridFS can't run against the in-memory fake db (no fake GridFSBucket —
// see `file-storage.ts`'s doc comment on the testing boundary), so the
// storage layer is mocked at this boundary and covered manually instead.
vi.mock("@/lib/file-storage", () => ({
  storeFile: storeFileMock,
}));

import { MongoUploadService } from "@/services/mongo/mongo-upload-service";

const TENANT_A = "tenant-a";

beforeEach(() => {
  storeFileMock.mockClear();
});

function seed() {
  const db = createFakeDb({
    datasets: [{ _id: "ds-a", dataProductId: "dp-a", version: "2.1.0" }],
  });
  getDbMock.mockResolvedValue(db);
  storeFileMock.mockResolvedValue("storage-file-1");
  return db;
}

describe("MongoUploadService", () => {
  it("stores a valid upload, creates an INBOUND exchange, a download, an OUTBOUND exchange, and a notification", async () => {
    const db = seed();
    const service = new MongoUploadService();
    const file = new File(["id,name\n1,a\n2,b\n"], "data.csv", { type: "text/csv" });

    const result = await service.uploadFile(TENANT_A, file, {
      datasetId: "ds-a",
      filename: "data.csv",
      fileSize: file.size,
      fileType: "text/csv",
    });

    expect(result.status).toBe("COMPLETED");
    expect(storeFileMock).toHaveBeenCalledWith("data.csv", "text/csv", expect.any(Buffer));

    const exchanges = await db.collection("exchanges").find({ tenantId: TENANT_A }).toArray();
    expect(exchanges).toHaveLength(2);
    const inbound = exchanges.find((e) => e.direction === "INBOUND");
    const outbound = exchanges.find((e) => e.direction === "OUTBOUND");
    expect(inbound?.status).toBe("COMPLETED");
    expect(inbound?.recordCount).toBe(2);
    expect(inbound?.schemaVersion).toBe("2.1.0");
    expect(outbound?.status).toBe("COMPLETED");
    expect(result.uploadId).toBe(inbound?._id);

    const downloads = await db.collection("downloads").find({ tenantId: TENANT_A }).toArray();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.storageFileId).toBe("storage-file-1");

    const notifications = await db.collection("notifications").find({ tenantId: TENANT_A }).toArray();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("EXCHANGE_COMPLETED");
  });

  it("rejects an unsupported file type without storing bytes or creating a download", async () => {
    const db = seed();
    const service = new MongoUploadService();
    const file = new File(["not real parquet"], "data.exe", { type: "application/octet-stream" });

    const result = await service.uploadFile(TENANT_A, file, {
      datasetId: "ds-a",
      filename: "data.exe",
      fileSize: file.size,
      fileType: "application/octet-stream",
    });

    expect(result.status).toBe("FAILED");
    expect(storeFileMock).not.toHaveBeenCalled();

    const exchanges = await db.collection("exchanges").find({ tenantId: TENANT_A }).toArray();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.status).toBe("FAILED");
    expect(exchanges[0]?.validationErrors).toHaveLength(1);

    const downloads = await db.collection("downloads").find({ tenantId: TENANT_A }).toArray();
    expect(downloads).toHaveLength(0);

    const notifications = await db.collection("notifications").find({ tenantId: TENANT_A }).toArray();
    expect(notifications[0]?.type).toBe("EXCHANGE_FAILED");
  });
});
