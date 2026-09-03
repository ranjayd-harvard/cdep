import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoExchangeService } from "@/services/mongo/mongo-exchange-service";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function seed() {
  const db = createFakeDb({
    exchanges: [
      { _id: "exch-a1", tenantId: TENANT_A, datasetId: "ds-a", direction: "INBOUND", status: "COMPLETED", receivedAt: "2026-01-01T00:00:00Z" },
      { _id: "exch-b1", tenantId: TENANT_B, datasetId: "ds-b", direction: "INBOUND", status: "COMPLETED", receivedAt: "2026-01-02T00:00:00Z" },
    ],
  });
  getDbMock.mockResolvedValue(db);
}

describe("MongoExchangeService", () => {
  it("only returns exchanges belonging to the requesting tenant", async () => {
    seed();
    const service = new MongoExchangeService();

    const exchanges = await service.getExchanges(TENANT_A);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.id).toBe("exch-a1");
  });

  it("returns null for an exchange that exists but belongs to another tenant", async () => {
    seed();
    const service = new MongoExchangeService();

    const exchange = await service.getExchange(TENANT_A, "exch-b1");

    expect(exchange).toBeNull();
  });

  it("returns the exchange for the tenant it actually belongs to", async () => {
    seed();
    const service = new MongoExchangeService();

    const exchange = await service.getExchange(TENANT_B, "exch-b1");

    expect(exchange?.id).toBe("exch-b1");
  });
});
