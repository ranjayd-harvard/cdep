// Required end-to-end demonstration (spec §60-71/§77): Vobis Org / Default
// Tenant / Event Performance, walked entirely through the real HTTP API
// (via Fastify's in-process inject — no separate server process to manage)
// against a real running data-product-catalog-service. Prints the flow
// spec §77 expects: DENY -> grant -> ALLOW -> subscribe -> ACTIVE -> pause
// -> resume -> revoke -> SUSPENDED -> activate-rejected -> restore ->
// reactivate -> delivery-context returned, and stops there.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { pool } from "../src/database/pool.js";
import { resolveMigrationsDir, runMigrations } from "../src/database/migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ORGANIZATION_ID = "org-vobis-org-722aea";
const TENANT_ID = "tenant-default-47d849";
const DATA_PRODUCT_ID = "event-performance";

const INTERNAL_HEADERS = {
  "x-internal-api-key": "dev-internal-key-change-me",
  "x-actor-type": "SERVICE",
  "x-actor-id": "demo-script",
  "x-actor-role": "PLATFORM_ADMIN",
};

function customerToken(): string {
  const payload = { sub: "usr-vobis-1", organization_id: ORGANIZATION_ID, active_tenant_id: TENANT_ID, role: "CUSTOMER_ADMIN" };
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

async function main() {
  await runMigrations(pool, resolveMigrationsDir(__dirname));
  const app = await buildApp();
  const token = customerToken();

  section("Step 1: registered Catalog product (owned by data-product-catalog-service, not duplicated here)");
  const product = (await fetch(`${process.env.CATALOG_SERVICE_URL}/v1/data-products/${DATA_PRODUCT_ID}`).then((r) => r.json())) as {
    dataProductId: string;
    activeVersion: unknown;
    status: string;
  };
  show("Catalog product", { dataProductId: product.dataProductId, activeVersion: product.activeVersion, status: product.status });

  section("Step 2: evaluate entitlement before grant");
  const beforeGrant = await app.inject({
    method: "POST",
    url: "/internal/v1/entitlements/evaluate",
    headers: INTERNAL_HEADERS,
    payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID },
  });
  show("Decision", beforeGrant.json());

  section("Step 3: grant entitlement ALLOW, then re-evaluate");
  const grant = await app.inject({
    method: "POST",
    url: "/internal/v1/entitlements",
    headers: INTERNAL_HEADERS,
    payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID, effect: "ALLOW", reason: "Customer contract" },
  });
  const entitlementId = grant.json().entitlement_id as string;
  const afterGrant = await app.inject({
    method: "POST",
    url: "/internal/v1/entitlements/evaluate",
    headers: INTERNAL_HEADERS,
    payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID },
  });
  show("Decision", afterGrant.json());

  section("Step 4: create subscription (1.x, FILE/PARQUET/DAILY/06:00 UTC/7 days)");
  const create = await app.inject({
    method: "POST",
    url: "/v1/subscriptions",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      data_product_id: DATA_PRODUCT_ID,
      version_policy: "1.x",
      delivery: { method: "FILE", format: "PARQUET", frequency: "DAILY", delivery_time: "06:00:00", timezone: "UTC", retention_days: 7 },
    },
  });
  const subscriptionId = create.json().subscription_id as string;
  show("Subscription", create.json());

  section("Step 5: read subscription");
  show("Subscription", (await app.inject({ method: "GET", url: `/v1/subscriptions/${subscriptionId}`, headers: { authorization: `Bearer ${token}` } })).json());

  section("Step 6: pause subscription (entitlement remains ALLOW)");
  show("Subscription", (await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/pause`, headers: { authorization: `Bearer ${token}` } })).json());

  section("Step 7: resume subscription (reruns eligibility)");
  show("Subscription", (await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/resume`, headers: { authorization: `Bearer ${token}` } })).json());

  section("Step 8: revoke/deny entitlement -> subscription cascades to SUSPENDED");
  show("Entitlement", (await app.inject({ method: "POST", url: `/internal/v1/entitlements/${entitlementId}/deny`, headers: INTERNAL_HEADERS })).json());
  show("Subscription", (await app.inject({ method: "GET", url: `/v1/subscriptions/${subscriptionId}`, headers: { authorization: `Bearer ${token}` } })).json());

  section("Step 9: attempt to reactivate while DENY (expect rejection)");
  const rejected = await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/resume`, headers: { authorization: `Bearer ${token}` } });
  show(`Rejected (HTTP ${rejected.statusCode})`, rejected.json());

  section("Step 10: restore entitlement, then explicitly reactivate");
  show("Entitlement", (await app.inject({ method: "POST", url: `/internal/v1/entitlements/${entitlementId}/allow`, headers: INTERNAL_HEADERS })).json());
  show("Subscription", (await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/resume`, headers: { authorization: `Bearer ${token}` } })).json());

  section("Step 11: Phase 7 -facing delivery-context (then STOP — no scheduling, no publication)");
  show("Delivery context", (await app.inject({ method: "GET", url: `/internal/v1/subscriptions/${subscriptionId}/delivery-context`, headers: INTERNAL_HEADERS })).json());

  // eslint-disable-next-line no-console
  console.log("\nDemo complete. Phase 6 stops here — Phase 7 owns due-time evaluation and publication requests.");

  await app.close();
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Demo failed:", err);
  process.exit(1);
});
