import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { servingStorePool } from "../../database/pool.js";
import { truncateServingStore } from "../setup/db.js";

// Full-stack e2e (spec §8.16/§8.17/§8.18/§8.19): exercises the real,
// running data-product-catalog-service and subscription-service over HTTP
// (no Catalog/Subscription internals mocked, same discipline
// subscription-service's own vobis-demo.test.ts follows) — requires both
// to already have "event-performance" 1.0.0 registered with its Phase 8
// API contract (see data-product-catalog-service/contracts/examples/
// event-performance-v1.0.yaml). Serving-store rows are inserted directly
// (bypassing serving-projection-service, a separate Python project this
// Node test suite cannot orchestrate) with the same shape the projector
// itself produces.
const CATALOG_URL = process.env.CATALOG_SERVICE_URL ?? "http://localhost:8092";
const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_SERVICE_URL ?? "http://localhost:8093";
const INTERNAL_KEY = "dev-internal-key-change-me";
const INTERNAL_HEADERS = {
  "x-internal-api-key": INTERNAL_KEY,
  "x-actor-type": "SERVICE",
  "x-actor-id": "e2e-test",
  "x-actor-role": "PLATFORM_ADMIN",
  "Content-Type": "application/json",
};

const suffix = randomUUID().slice(0, 8);
const TENANT_A = { organizationId: `org-e2e-a-${suffix}`, tenantId: `tenant-e2e-a-${suffix}` };
const TENANT_B = { organizationId: `org-e2e-b-${suffix}`, tenantId: `tenant-e2e-b-${suffix}` };

function devToken(tenant: { organizationId: string; tenantId: string }, sub: string): string {
  const payload = { sub, organization_id: tenant.organizationId, active_tenant_id: tenant.tenantId, role: "CUSTOMER_ADMIN" };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

async function grantAndSubscribe(tenant: { organizationId: string; tenantId: string }, sub: string): Promise<void> {
  const grant = await fetch(`${SUBSCRIPTION_URL}/internal/v1/entitlements`, {
    method: "POST",
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({ organization_id: tenant.organizationId, tenant_id: tenant.tenantId, data_product_id: "event-performance", effect: "ALLOW", reason: "e2e" }),
  });
  if (!grant.ok) throw new Error(`grant failed: ${grant.status} ${await grant.text()}`);

  const subscribe = await fetch(`${SUBSCRIPTION_URL}/v1/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${devToken(tenant, sub)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data_product_id: "event-performance", version_policy: "1.0.0", delivery: { method: "API", frequency: "ON_DEMAND" } }),
  });
  if (!subscribe.ok) throw new Error(`subscribe failed: ${subscribe.status} ${await subscribe.text()}`);
}

async function insertServingRow(tenant: { organizationId: string; tenantId: string }, input: { eventId: string; venueId: string; ticketsSold: number; grossRevenue: string }): Promise<void> {
  await servingStorePool.query(
    `INSERT INTO api_serving.event_performance_events
       (organization_id, tenant_id, product_version, event_id, venue_id, event_date, tickets_sold, gross_revenue, revenue_per_ticket,
        source_updated_at, serving_snapshot_id, source_change_token, _gold_pipeline_run_id, _silver_pipeline_run_id, ingestion_id, exchange_id, storage_path)
     VALUES ($1, $2, '1.0.0', $3, $4, '2026-09-01', $5, $6, $6, now(), 'snap-e2e', 'token-e2e', 'gpr-e2e', 'spr-e2e', 'ing-e2e', 'exch-e2e', 's3://gold/e2e')`,
    [tenant.organizationId, tenant.tenantId, input.eventId, input.venueId, input.ticketsSold, input.grossRevenue],
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await grantAndSubscribe(TENANT_A, "usr-e2e-a");
  await grantAndSubscribe(TENANT_B, "usr-e2e-b");
  await insertServingRow(TENANT_A, { eventId: "EVT1001", venueId: "VEN001", ticketsSold: 1200, grossRevenue: "84000.00" });
  await insertServingRow(TENANT_B, { eventId: "EVT1001", venueId: "VEN999", ticketsSold: 3000, grossRevenue: "250000.00" });
});

afterAll(async () => {
  await app.close();
  await truncateServingStore();
  await servingStorePool.end();
});

describe("Phase 8 end-to-end: Catalog resolution -> entitlement -> subscription -> version resolution -> serving query", () => {
  it("Tenant A GET EVT1001 returns only Tenant A's record", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events?event_id=EVT1001",
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-e2e-a")}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ event_id: "EVT1001", venue_id: "VEN001", tickets_sold: 1200, gross_revenue: "84000.00" });
    expect(body.product).toEqual({ id: "event-performance", version: "1.0.0" });
  });

  it("Tenant B GET EVT1001 returns only Tenant B's record — never Tenant A's", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events?event_id=EVT1001",
      headers: { authorization: `Bearer ${devToken(TENANT_B, "usr-e2e-b")}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ event_id: "EVT1001", venue_id: "VEN999", tickets_sold: 3000, gross_revenue: "250000.00" });
  });

  it("?tenant_id=<Tenant B> on Tenant A's token cannot change Tenant A's security context", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/data-products/event-performance/events?tenant_id=${TENANT_B.tenantId}`,
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-e2e-a")}` },
    });
    // tenant_id is not a contract-allowlisted filter, so this fails closed
    // rather than being silently ignored — either outcome proves the same
    // invariant (query params never establish tenant identity), but a
    // hard rejection is the stronger guarantee.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_FILTER");
  });

  it("never exposes internal fields, even when explicitly requested via ?fields=", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events?fields=event_id,tenant_id",
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-e2e-a")}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_FIELD_SELECTION");
  });

  it("a full unfiltered response never contains any internal field name", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events?event_id=EVT1001",
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-e2e-a")}` },
    });
    const raw = JSON.stringify(res.json());
    for (const internalField of ["organization_id", "tenant_id", "_gold_pipeline_run_id", "_silver_pipeline_run_id", "ingestion_id", "exchange_id", "storage_path", "source_change_token"]) {
      expect(raw).not.toContain(internalField);
    }
  });

  it("rejects an unsupported filter (e.g. gross_revenue_gt)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events?gross_revenue_gt=50000",
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-e2e-a")}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_FILTER");
  });

  it("rejects a request with no Authorization header when not in dev-fallback identity", async () => {
    // AUTH_MODE=development's no-header fallback maps to a fixed dev
    // profile (see customer-auth.middleware.ts) — a malformed Bearer token
    // is the reachable way to exercise the rejection path in this mode.
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events",
      headers: { authorization: "Bearer not-valid-base64url!!!" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a token with an unrecognized role", async () => {
    const token = Buffer.from(JSON.stringify({ sub: "usr-x", organization_id: TENANT_A.organizationId, active_tenant_id: TENANT_A.tenantId, role: "NOT_A_REAL_ROLE" })).toString("base64url");
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_TOKEN");
  });

  it("returns PRODUCT_NOT_FOUND (404) for a tenant with no entitlement — never reveals the product exists", async () => {
    const unentitled = { organizationId: `org-e2e-none-${suffix}`, tenantId: `tenant-e2e-none-${suffix}` };
    const res = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events",
      headers: { authorization: `Bearer ${devToken(unentitled, "usr-e2e-none")}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("cursor pagination is deterministic and a cross-tenant cursor is rejected", async () => {
    await insertServingRow(TENANT_A, { eventId: "EVT1002", venueId: "VEN001", ticketsSold: 800, grossRevenue: "42000.00" });

    const page1 = await app.inject({
      method: "GET",
      url: "/v1/data-products/event-performance/events?page_size=1",
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-e2e-a")}` },
    });
    const body1 = page1.json();
    expect(body1.data).toHaveLength(1);
    expect(body1.page.next_cursor).toBeTruthy();

    const page2 = await app.inject({
      method: "GET",
      url: `/v1/data-products/event-performance/events?page_size=1&cursor=${encodeURIComponent(body1.page.next_cursor)}`,
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-e2e-a")}` },
    });
    const body2 = page2.json();
    expect(body2.data).toHaveLength(1);
    expect(body2.data[0].event_id).not.toBe(body1.data[0].event_id);

    const crossTenant = await app.inject({
      method: "GET",
      url: `/v1/data-products/event-performance/events?page_size=1&cursor=${encodeURIComponent(body1.page.next_cursor)}`,
      headers: { authorization: `Bearer ${devToken(TENANT_B, "usr-e2e-b")}` },
    });
    expect(crossTenant.statusCode).toBe(400);
    expect(crossTenant.json().error.code).toBe("INVALID_CURSOR");
  });
});
