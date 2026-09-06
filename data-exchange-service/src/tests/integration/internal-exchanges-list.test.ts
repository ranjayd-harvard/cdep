import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeader, createTestApp, TENANT_A, TENANT_B } from "../setup/test-helpers.js";
import { env } from "../../config/env.js";

// Covers the internal-only, cross-tenant exchange list the superadmin
// portal's Lakehouse Ingestion admin page (/admin/lakehouse) reads from --
// the customer-facing GET /v1/exchanges is tenant-JWT-scoped and cannot
// serve this use case.
describe("internal exchange list endpoint", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a request without a valid internal API key", async () => {
    const res = await app.inject({ method: "GET", url: "/internal/v1/exchanges" });
    expect(res.statusCode).toBe(403);
  });

  it("lists exchanges across two different tenants in one call", async () => {
    const filenameA = `crosstenant_a_${randomUUID()}.csv`;
    const filenameB = `crosstenant_b_${randomUUID()}.csv`;

    const initiatedA = await app
      .inject({
        method: "POST",
        url: "/v1/uploads",
        headers: authHeader(TENANT_A),
        payload: { dataProductId: "event-data", filename: filenameA, contentType: "text/csv", sizeBytes: 10 },
      })
      .then((res) => res.json());

    const initiatedB = await app
      .inject({
        method: "POST",
        url: "/v1/uploads",
        headers: authHeader(TENANT_B),
        payload: { dataProductId: "event-data", filename: filenameB, contentType: "text/csv", sizeBytes: 10 },
      })
      .then((res) => res.json());

    const res = await app.inject({
      method: "GET",
      url: "/internal/v1/exchanges?limit=500",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      exchangeId: string;
      organizationId: string;
      tenantId: string;
      filename: string | null;
    }>;

    const foundA = items.find((i) => i.exchangeId === initiatedA.exchangeId);
    const foundB = items.find((i) => i.exchangeId === initiatedB.exchangeId);
    expect(foundA).toBeTruthy();
    expect(foundB).toBeTruthy();
    // The behavioral proof this endpoint is genuinely cross-tenant, not
    // accidentally reusing the tenant-scoped repo function: each item
    // carries its OWN owner, not the caller's (there is no caller tenant).
    expect(foundA?.organizationId).toBe(TENANT_A.organization_id);
    expect(foundA?.tenantId).toBe(TENANT_A.active_tenant_id);
    expect(foundB?.organizationId).toBe(TENANT_B.organization_id);
    expect(foundB?.tenantId).toBe(TENANT_B.active_tenant_id);
    // createExchangeFile (fileRole: DATA) runs in the same transaction as
    // the exchange row itself during initiateUpload -- so the original
    // filename is already joinable at this point, not just after complete.
    expect(foundA?.filename).toBe(filenameA);
    expect(foundB?.filename).toBe(filenameB);
  });

  it("filters by direction", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/v1/exchanges?direction=INBOUND&limit=500",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ direction: string }>;
    expect(items.every((i) => i.direction === "INBOUND")).toBe(true);
  });
});
