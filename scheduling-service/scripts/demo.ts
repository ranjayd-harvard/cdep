// Repeatable demonstration (AGENTS.md sections 73-74/77): Vobis Org /
// Default Tenant / Event Performance, walked through the real HTTP APIs of
// data-product-catalog-service, subscription-service, and
// data-publication-service, plus this service's own reconcile/scan ticks
// invoked directly (the test-clock-equivalent "run due schedules now"
// escape hatch AGENTS.md section 74 step 11 asks for, so nobody has to
// wait on a real DAILY/WEEKLY clock to see the flow).
import { pool } from "../src/database/pool.js";
import { resolveMigrationsDir, runMigrations } from "../src/database/migrations.js";
import { leaderElector, manualTriggerService, schedulerCoordinator } from "../src/container.js";
import { findProjectionBySubscriptionId } from "../src/infrastructure/persistence/projection.repository.js";
import { listExecutions } from "../src/infrastructure/persistence/execution.repository.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  const subscriptionServiceUrl = process.env.SUBSCRIPTION_SERVICE_URL;
  const catalogServiceUrl = process.env.CATALOG_SERVICE_URL;
  if (!subscriptionServiceUrl || !catalogServiceUrl) {
    throw new Error("SUBSCRIPTION_SERVICE_URL and CATALOG_SERVICE_URL must be set (see .env.example).");
  }

  const token = customerToken();

  section("Step 1: registered Catalog product (owned by data-product-catalog-service, not duplicated here)");
  const product = (await fetch(`${catalogServiceUrl}/v1/data-products/${DATA_PRODUCT_ID}`).then((r) => r.json())) as {
    dataProductId: string;
    activeVersion: unknown;
    status: string;
  };
  show("Catalog product", { dataProductId: product.dataProductId, activeVersion: product.activeVersion, status: product.status });

  section("Step 2: grant entitlement (Subscription Service)");
  await fetch(`${subscriptionServiceUrl}/internal/v1/entitlements`, {
    method: "POST",
    headers: { ...INTERNAL_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID, effect: "ALLOW", reason: "Demo" }),
  });

  section("Step 3: clean up any previous demo subscription, then create a fresh DAILY subscription");
  const existing = (await fetch(`${subscriptionServiceUrl}/v1/subscriptions`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())) as {
    items: Array<{ subscription_id: string; data_product_id: string; status: string }>;
  };
  for (const item of existing.items) {
    if (item.data_product_id === DATA_PRODUCT_ID && item.status !== "CANCELLED") {
      await fetch(`${subscriptionServiceUrl}/v1/subscriptions/${item.subscription_id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    }
  }
  const create = await fetch(`${subscriptionServiceUrl}/v1/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      data_product_id: DATA_PRODUCT_ID,
      version_policy: "1.x",
      delivery: { method: "FILE", format: "PARQUET", frequency: "DAILY", delivery_time: "06:00:00", timezone: "UTC", retention_days: 7 },
    }),
  }).then((r) => r.json());
  const subscriptionId = (create as { subscription_id: string }).subscription_id;
  show("Subscription", create);

  section("Step 4: reconcile — the Scheduler discovers the subscription and computes next_run_at");
  await schedulerCoordinator.runReconcileTick();
  const projection = await findProjectionBySubscriptionId(pool, subscriptionId);
  show("Scheduler projection", projection);

  section("Step 5: backdate next_run_at (test-clock escape hatch — avoids waiting on the real DAILY clock)");
  await pool.query("UPDATE scheduler_subscription_projection SET next_run_at = now() - interval '5 seconds' WHERE subscription_id = $1", [subscriptionId]);

  section("Step 6: run a scan tick — claims the due schedule, creates a ScheduledExecution, runs the full policy pipeline");
  await schedulerCoordinator.runScanTick();

  const page = await listExecutions(pool, { subscriptionId, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID });
  show("Scheduled execution", page.items[0]);

  section("Step 7: on-demand trigger (bypasses the schedule entirely, same policy pipeline)");
  const onDemand = await manualTriggerService.trigger({
    subscriptionId,
    reason: "ON_DEMAND",
    idempotencyKey: null,
    actorType: "USER",
    actorId: "usr-vobis-1",
    requireOwnership: { organizationId: ORGANIZATION_ID, tenantId: TENANT_ID },
  });
  show("On-demand execution", onDemand);

  // eslint-disable-next-line no-console
  console.log(
    "\nDemo complete. A publication actually reaching SUCCEEDED requires a real completed Bronze->Silver->Gold pipeline run " +
      "for this exact (org, tenant, product, version) scope in data-lakehouse — without one, Publication Service correctly " +
      "returns GOLD_READY_NOT_FOUND and the execution lands in RETRY_WAIT, fully audited either way.",
  );

  await leaderElector.release();
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Demo failed:", err);
  process.exit(1);
});
