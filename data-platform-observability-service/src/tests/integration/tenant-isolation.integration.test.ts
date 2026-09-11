import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { FastifyInstance } from "fastify";
import { ingestParsedEvent } from "../../application/services/event-ingestion.service.js";
import { pool, truncateAll } from "../setup/db.js";
import { DEMO_ORG, DEMO_PRODUCT, DEMO_TENANT, makeEnvelope } from "../fixtures/envelope-fixtures.js";
import { FakeCatalogClient } from "../fixtures/fake-catalog-client.js";

const catalogClient = new FakeCatalogClient();

const TENANT_B_ORG = "org-vobis-org-722aea";
const TENANT_B = "tenant-observability-test-b";

function devToken(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

const TENANT_A_TOKEN = devToken({ sub: "usr-8a74b91", organization_id: DEMO_ORG, active_tenant_id: DEMO_TENANT, role: "CUSTOMER_ADMIN" });
const TENANT_B_TOKEN = devToken({ sub: "usr-tenant-b", organization_id: TENANT_B_ORG, active_tenant_id: TENANT_B, role: "CUSTOMER_ADMIN" });

let app: FastifyInstance;

beforeEach(async () => {
  await truncateAll();
  catalogClient.setVersionDetail(null);
  app = await buildApp();

  // Tenant A's execution — reaches a delivery-terminal stage.
  await ingestParsedEvent(
    makeEnvelope({
      eventId: "iso-a-1",
      context: { organizationId: DEMO_ORG, tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT },
      correlation: { publicationId: "pub-iso-a", outboundExchangeId: "exc-iso-a-out" },
      operation: { stage: "PUBLICATION", status: "SUCCEEDED" },
    }),
    catalogClient,
  );
  await ingestParsedEvent(
    makeEnvelope({
      eventId: "iso-a-2",
      context: { organizationId: DEMO_ORG, tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT },
      correlation: { outboundExchangeId: "exc-iso-a-out" },
      operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
    }),
    catalogClient,
  );

  // Tenant B's execution — same data_product_id, deliberately different tenant.
  await ingestParsedEvent(
    makeEnvelope({
      eventId: "iso-b-1",
      context: { organizationId: TENANT_B_ORG, tenantId: TENANT_B, dataProductId: DEMO_PRODUCT },
      correlation: { publicationId: "pub-iso-b" },
      operation: { stage: "PUBLICATION", status: "FAILED" },
    }),
    catalogClient,
  );
});

afterAll(async () => {
  await pool.end();
});

describe("tenant isolation (spec section 28/41)", () => {
  it("internal executions list, filtered by tenant_id, never leaks the other tenant's executions", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/internal/v1/operations/data-products/${DEMO_PRODUCT}/executions?tenant_id=${DEMO_TENANT}`,
      headers: { "x-internal-api-key": "dev-internal-key-change-me", "x-actor-type": "SERVICE", "x-actor-id": "test", "x-actor-role": "PLATFORM_ADMIN" },
    });
    const body = response.json() as { items: Array<{ tenant_id: string; publication_id: string | null }> };
    expect(body.items.every((item) => item.tenant_id === DEMO_TENANT)).toBe(true);
    expect(body.items.some((item) => item.publication_id === "pub-iso-b")).toBe(false);
  });

  it("internal alerts list, filtered by tenant_id, never leaks the other tenant's alerts", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/internal/v1/operations/alerts?tenant_id=${TENANT_B}`,
      headers: { "x-internal-api-key": "dev-internal-key-change-me", "x-actor-type": "SERVICE", "x-actor-id": "test", "x-actor-role": "PLATFORM_ADMIN" },
    });
    const body = response.json() as { items: Array<{ tenant_id?: string; title: string }> };
    // Tenant B's failed publication should have produced an alert; none of
    // tenant A's data should ever appear in this tenant-scoped query.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((item) => item.title.includes("pub-iso-a"))).toBe(false);
  });

  it("the customer-safe status route returns only the authenticated tenant's own data, never the other tenant's", async () => {
    const responseA = await app.inject({
      method: "GET",
      url: `/v1/customer/data-products/${DEMO_PRODUCT}/status`,
      headers: { authorization: `Bearer ${TENANT_A_TOKEN}` },
    });
    expect(responseA.statusCode).toBe(200);
    const bodyA = responseA.json();
    // Tenant A's execution reached a successful delivery — its own data,
    // never tenant B's (which never delivered).
    expect(bodyA.lastSuccessfulDeliveryAt).not.toBeNull();

    const responseB = await app.inject({
      method: "GET",
      url: `/v1/customer/data-products/${DEMO_PRODUCT}/status`,
      headers: { authorization: `Bearer ${TENANT_B_TOKEN}` },
    });
    expect(responseB.statusCode).toBe(200);
    const bodyB = responseB.json();
    // Tenant B's own execution never delivered — must never inherit tenant
    // A's successful delivery timestamp.
    expect(bodyB.lastSuccessfulDeliveryAt).toBeNull();
  });

  it("a tenant with no operational data of its own gets the anti-enumeration 404, never tenant A's or B's data", async () => {
    const strangerToken = devToken({ sub: "usr-stranger", organization_id: "org-stranger", active_tenant_id: "tenant-stranger", role: "CUSTOMER_ADMIN" });
    const response = await app.inject({
      method: "GET",
      url: `/v1/customer/data-products/${DEMO_PRODUCT}/status`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_STATUS_NOT_FOUND");
  });
});
