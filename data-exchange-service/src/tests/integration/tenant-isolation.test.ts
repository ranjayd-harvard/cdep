import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeader, createTestApp, TENANT_A, TENANT_B } from "../setup/test-helpers.js";

// AGENTS.md section 52: cross-tenant access must fail, and must fail in a
// way indistinguishable from "not found" (section 47) — never a distinct
// "forbidden, belongs to another tenant" response that would confirm the
// resource's existence to an unauthorized caller.
describe("multi-tenant isolation", () => {
  let app: FastifyInstance;
  let exchangeIdOwnedByTenantA: string;

  beforeAll(async () => {
    app = await createTestApp();

    const csv = "a,b\n1,2\n";
    const initiateRes = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: authHeader(TENANT_A),
      payload: {
        dataProductId: "event-data",
        filename: `isolation_${randomUUID()}.csv`,
        contentType: "text/csv",
        sizeBytes: Buffer.byteLength(csv),
      },
    });
    const initiated = initiateRes.json();
    exchangeIdOwnedByTenantA = initiated.exchangeId;

    await fetch(initiated.upload.url, { method: "PUT", headers: { "Content-Type": "text/csv" }, body: csv });
    await app.inject({
      method: "POST",
      url: `/v1/uploads/${exchangeIdOwnedByTenantA}/complete`,
      headers: authHeader(TENANT_A),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant B cannot see tenant A's exchange in detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${exchangeIdOwnedByTenantA}`,
      headers: authHeader(TENANT_B),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("EXCHANGE_NOT_FOUND");
  });

  it("tenant B cannot list tenant A's exchange", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/exchanges", headers: authHeader(TENANT_B) });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((e: { exchangeId: string }) => e.exchangeId);
    expect(ids).not.toContain(exchangeIdOwnedByTenantA);
  });

  it("tenant B cannot complete tenant A's upload", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/uploads/${exchangeIdOwnedByTenantA}/complete`,
      headers: authHeader(TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot fetch tenant A's validation results", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${exchangeIdOwnedByTenantA}/validation`,
      headers: authHeader(TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot fetch tenant A's lifecycle events", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${exchangeIdOwnedByTenantA}/events`,
      headers: authHeader(TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot request a download URL for tenant A's exchange", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/downloads/${exchangeIdOwnedByTenantA}/url`,
      headers: authHeader(TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });
});
