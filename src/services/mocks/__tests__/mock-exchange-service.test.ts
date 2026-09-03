import { describe, expect, it } from "vitest";
import { MockExchangeService } from "@/services/mocks/mock-exchange-service";
import { DEFAULT_TENANT_ID } from "@/data/mocks/tenants";
import { MOCK_EXCHANGES } from "@/data/mocks/exchanges";

describe("MockExchangeService", () => {
  const service = new MockExchangeService();

  it("returns all exchanges belonging to the requesting tenant", async () => {
    const exchanges = await service.getExchanges(DEFAULT_TENANT_ID);
    expect(exchanges).toHaveLength(MOCK_EXCHANGES.length);
    expect(exchanges.every((exchange) => exchange.tenantId === DEFAULT_TENANT_ID)).toBe(true);
  });

  it("returns no exchanges for a tenant with no matching records", async () => {
    const exchanges = await service.getExchanges("tenant-unknown");
    expect(exchanges).toEqual([]);
  });

  it("returns a single exchange scoped to the requesting tenant", async () => {
    const exchange = await service.getExchange(DEFAULT_TENANT_ID, "exch-0004");
    expect(exchange?.status).toBe("FAILED");
    expect(exchange?.validationErrors.length).toBeGreaterThan(0);
  });

  it("does not leak an exchange to a tenant it doesn't belong to", async () => {
    const exchange = await service.getExchange("tenant-unknown", "exch-0004");
    expect(exchange).toBeNull();
  });
});
