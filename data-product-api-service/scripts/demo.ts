// Mandatory Phase 8 demonstrations (spec §8.17/§8.18/§8.19), walked
// entirely through the real HTTP API (Fastify's in-process inject) against
// real running data-product-catalog-service + subscription-service, and
// real serving-store rows produced by serving-projection-service.
//
// Prerequisite (run once, from serving-projection-service/):
//   .venv/bin/python scripts/seed_demo_gold.py --mode initial
//   .venv/bin/python scripts/run_projection.py --refresh-type FULL
//
// Usage: npm run demo
import { buildApp } from "../src/app.js";
import { servingStorePool } from "../src/database/pool.js";

const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_SERVICE_URL ?? "http://localhost:8093";
const INTERNAL_HEADERS = {
  "x-internal-api-key": "dev-internal-key-change-me",
  "x-actor-type": "SERVICE",
  "x-actor-id": "demo-script",
  "x-actor-role": "PLATFORM_ADMIN",
  "Content-Type": "application/json",
};

// Matches serving-projection-service/scripts/seed_demo_gold.py's fixture
// tenants exactly.
const TENANT_A = { organizationId: "org-vobis-org-722aea", tenantId: "tenant-default-47d849" };
const TENANT_B = { organizationId: "org-northwind-b91cde", tenantId: "tenant-north-9a11c2" };

function devToken(tenant: { organizationId: string; tenantId: string }, sub: string): string {
  const payload = { sub, organization_id: tenant.organizationId, active_tenant_id: tenant.tenantId, role: "CUSTOMER_ADMIN" };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function section(title: string) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}

function show(label: string, value: unknown) {
  // eslint-disable-next-line no-console
  console.log(`${label}:`, JSON.stringify(value, null, 2));
}

async function ensureEntitledAndSubscribed(tenant: { organizationId: string; tenantId: string }, sub: string): Promise<void> {
  await fetch(`${SUBSCRIPTION_URL}/internal/v1/entitlements`, {
    method: "POST",
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({ organization_id: tenant.organizationId, tenant_id: tenant.tenantId, data_product_id: "event-performance", effect: "ALLOW", reason: "Phase 8 demo" }),
  });
  await fetch(`${SUBSCRIPTION_URL}/v1/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${devToken(tenant, sub)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data_product_id: "event-performance", version_policy: "1.0.0", delivery: { method: "API", frequency: "ON_DEMAND" } }),
  });
}

async function main() {
  const app = await buildApp();

  section("Setup: grant entitlement + create an API subscription pinned to 1.0.0, for Tenant A and Tenant B");
  await ensureEntitledAndSubscribed(TENANT_A, "usr-vobis-1");
  await ensureEntitledAndSubscribed(TENANT_B, "usr-northwind-1");
  console.log("done (SUBSCRIPTION_ALREADY_EXISTS from a prior run is expected and harmless)");

  section("8.17 — Tenant A GET EVT1001 returns only Tenant A's record");
  const tenantA = await app.inject({
    method: "GET",
    url: "/v1/data-products/event-performance/events?event_id=EVT1001",
    headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-vobis-1")}` },
  });
  show("Tenant A response", tenantA.json());

  section("8.17 — Tenant B GET EVT1001 returns only Tenant B's record (same event_id, different data)");
  const tenantB = await app.inject({
    method: "GET",
    url: "/v1/data-products/event-performance/events?event_id=EVT1001",
    headers: { authorization: `Bearer ${devToken(TENANT_B, "usr-northwind-1")}` },
  });
  show("Tenant B response", tenantB.json());

  section("8.17 — ?tenant_id=<Tenant B's tenant> on Tenant A's token cannot change Tenant A's security context");
  const injectionAttempt = await app.inject({
    method: "GET",
    url: `/v1/data-products/event-performance/events?tenant_id=${TENANT_B.tenantId}`,
    headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-vobis-1")}` },
  });
  show("Injection attempt (rejected — tenant_id is not an allowlisted filter)", { status: injectionAttempt.statusCode, body: injectionAttempt.json() });

  section("8.18 — internal fields are present in the serving row...");
  const { rows } = await servingStorePool.query(
    `SELECT organization_id, tenant_id, _gold_pipeline_run_id, _silver_pipeline_run_id, ingestion_id, exchange_id, storage_path, source_change_token
     FROM api_serving.event_performance_events WHERE organization_id = $1 AND tenant_id = $2 AND event_id = 'EVT1001'`,
    [TENANT_A.organizationId, TENANT_A.tenantId],
  );
  show("Serving row internal fields", rows[0]);

  section("8.18 — ...but never appear in the API response, and explicitly requesting one is rejected");
  const fieldProbe = await app.inject({
    method: "GET",
    url: "/v1/data-products/event-performance/events?fields=event_id,tenant_id",
    headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-vobis-1")}` },
  });
  show("?fields=event_id,tenant_id (rejected)", { status: fieldProbe.statusCode, body: fieldProbe.json() });

  section("8.8 — cursor pagination: page_size=1, then follow next_cursor");
  const page1 = await app.inject({
    method: "GET",
    url: "/v1/data-products/event-performance/events?page_size=1",
    headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-vobis-1")}` },
  });
  show("Page 1", page1.json());
  const cursor = page1.json().page.next_cursor as string | null;
  if (cursor) {
    const page2 = await app.inject({
      method: "GET",
      url: `/v1/data-products/event-performance/events?page_size=1&cursor=${encodeURIComponent(cursor)}`,
      headers: { authorization: `Bearer ${devToken(TENANT_A, "usr-vobis-1")}` },
    });
    show("Page 2", page2.json());

    section("8.8 — Tenant A's cursor rejected when replayed by Tenant B");
    const crossTenant = await app.inject({
      method: "GET",
      url: `/v1/data-products/event-performance/events?page_size=1&cursor=${encodeURIComponent(cursor)}`,
      headers: { authorization: `Bearer ${devToken(TENANT_B, "usr-northwind-1")}` },
    });
    show("Cross-tenant cursor reuse (rejected)", { status: crossTenant.statusCode, body: crossTenant.json() });
  }

  await app.close();
  await servingStorePool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
