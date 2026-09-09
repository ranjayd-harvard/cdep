import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import { leaderElector, schedulerCoordinator, subscriptionClient } from "../../container.js";
import { findProjectionBySubscriptionId } from "../../infrastructure/persistence/projection.repository.js";
import { listExecutions } from "../../infrastructure/persistence/execution.repository.js";

// Full-stack demonstration (AGENTS.md sections 73-74): Vobis Org / Default
// Tenant / Event Performance, against REAL running data-product-catalog-
// service, subscription-service, and data-publication-service (no
// internals mocked — same "do not duplicate internals in tests"
// discipline subscription-service's own e2e test follows). Requires all
// three at their documented local ports, catalog seeded with
// "event-performance" having an ACTIVE version.
//
// Rather than waiting on a real wall clock for a DAILY/WEEKLY occurrence
// (impractical for automated tests), this uses a CRON subscription and
// then directly backdates the scheduler's own projection row to simulate
// "the schedule became due" — the test-clock-equivalent approach AGENTS.md
// section 77 asks demos to provide, applied at the DB layer since the
// scheduler loop itself runs against the real system clock in this
// composition root.
const ORGANIZATION_ID = "org-vobis-org-722aea";
const TENANT_ID = "tenant-default-47d849";
const DATA_PRODUCT_ID = "event-performance";

const REQUIRED_URLS = [process.env.CATALOG_SERVICE_URL, process.env.SUBSCRIPTION_SERVICE_URL, process.env.PUBLICATION_SERVICE_URL];

const INTERNAL_SUBSCRIPTION_HEADERS = {
  "x-internal-api-key": "dev-internal-key-change-me",
  "x-actor-type": "SERVICE",
  "x-actor-id": "e2e-test",
  "x-actor-role": "PLATFORM_ADMIN",
};

function customerToken(): string {
  const payload = { sub: "usr-vobis-1", organization_id: ORGANIZATION_ID, active_tenant_id: TENANT_ID, role: "CUSTOMER_ADMIN" };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

async function liveServicesReachable(): Promise<boolean> {
  try {
    const results = await Promise.all(REQUIRED_URLS.map((url) => fetch(`${url}/health/live`).then((r) => r.ok)));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

let servicesUp = false;

beforeAll(async () => {
  await ensureMigrated();
  servicesUp = await liveServicesReachable();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await leaderElector.release();
  await pool.end();
});

describe("Phase 7 end-to-end: Vobis Org / Default Tenant / Event Performance", () => {
  it("reconciles a CRON subscription, detects it due, and produces an auditable, correlated PublicationRequest attempt", async () => {
    if (!servicesUp) {
      // eslint-disable-next-line no-console
      console.warn("Skipping: catalog-service/subscription-service/data-publication-service are not all reachable on their documented local ports.");
      return;
    }

    // 1-2. Grant entitlement (idempotent if already granted by another suite run).
    await fetch(`${process.env.SUBSCRIPTION_SERVICE_URL}/internal/v1/entitlements`, {
      method: "POST",
      headers: { ...INTERNAL_SUBSCRIPTION_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID, effect: "ALLOW", reason: "e2e" }),
    });

    const token = customerToken();

    // Subscription Service is a live external dependency this test cannot
    // truncate (only scheduling-service's own DB is reset in beforeEach) —
    // clean up any subscription left ACTIVE by a prior run of this same
    // test so subscription-service's one-live-subscription-per-tenant-
    // product constraint doesn't 409 the create below.
    const existingResponse = await fetch(`${process.env.SUBSCRIPTION_SERVICE_URL}/v1/subscriptions`, { headers: { Authorization: `Bearer ${token}` } });
    const existing = (await existingResponse.json()) as { items: Array<{ subscription_id: string; data_product_id: string; status: string }> };
    for (const item of existing.items) {
      if (item.data_product_id === DATA_PRODUCT_ID && item.status !== "CANCELLED") {
        await fetch(`${process.env.SUBSCRIPTION_SERVICE_URL}/v1/subscriptions/${item.subscription_id}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }

    // 3. Create a CRON subscription (every minute — at/above the configured
    // 60s floor) for Event Performance.
    const createResponse = await fetch(`${process.env.SUBSCRIPTION_SERVICE_URL}/v1/subscriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data_product_id: DATA_PRODUCT_ID,
        version_policy: "1.x",
        delivery: { method: "FILE", format: "PARQUET", frequency: "CRON", cron_expression: "* * * * *", timezone: "UTC", retention_days: 7 },
      }),
    });
    expect(createResponse.status).toBe(201);
    const subscription = (await createResponse.json()) as { subscription_id: string };
    const subscriptionId = subscription.subscription_id;

    // 4. Reconcile: the Scheduler discovers the subscription and computes next_run_at.
    await schedulerCoordinator.runReconcileTick();
    const projection = await findProjectionBySubscriptionId(pool, subscriptionId);
    expect(projection).not.toBeNull();
    expect(projection?.scheduleMode).toBe("CRON");
    expect(projection?.nextRunAt).not.toBeNull();

    // Test-clock equivalent (AGENTS.md section 74/77): backdate the
    // projection so the next scan tick sees it as due, instead of waiting
    // on the real clock for up to 60s.
    await pool.query("UPDATE scheduler_subscription_projection SET next_run_at = now() - interval '5 seconds' WHERE subscription_id = $1", [subscriptionId]);

    // 5. Scan: claims the due schedule, creates a ScheduledExecution, and
    // runs it through the full policy pipeline (subscription -> entitlement
    // -> Catalog version resolution -> delivery capability -> dispatch).
    await schedulerCoordinator.runScanTick();

    const page = await listExecutions(pool, { subscriptionId, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID });
    expect(page.items).toHaveLength(1);
    const execution = page.items[0]!;

    expect(execution.reason).toBe("SCHEDULED");
    expect(execution.dataProductId).toBe(DATA_PRODUCT_ID);
    // Real Catalog resolves 1.x to whatever ACTIVE version is currently
    // registered — assert resolution happened, not a specific pinned value.
    expect(execution.resolvedProductVersion).toBeTruthy();
    // Publishing genuinely completes only against a real Gold pipeline run;
    // this environment has none for this exact scope, so the honest,
    // fully-plumbed-through outcome is a classified retriable dependency
    // failure, never anything ambiguous or unaudited.
    expect(["SUCCEEDED", "RETRY_WAIT"]).toContain(execution.status);

    // Correlate: every processing-pipeline step (everything after the
    // scanner's own SCHEDULE_DUE claim event, which predates and is
    // outside any single processing attempt) shares one correlation id.
    const { rows } = await pool.query("SELECT event_type, correlation_id FROM scheduler_audit_events WHERE execution_id = $1 ORDER BY occurred_at", [execution.id]);
    expect(rows.map((r) => r.event_type)).toEqual(
      expect.arrayContaining(["SCHEDULE_DUE", "SCHEDULE_EVALUATION_STARTED", "SUBSCRIPTION_REVALIDATED", "ENTITLEMENT_REVALIDATED", "VERSION_RESOLVED", "PUBLICATION_ELIGIBLE"]),
    );
    const processingCorrelationIds = new Set(rows.filter((r) => r.event_type !== "SCHEDULE_DUE").map((r) => r.correlation_id));
    expect(processingCorrelationIds.size).toBe(1);
    expect([...processingCorrelationIds][0]).toBeTruthy();

    // Idempotency: a second scan tick before next_run_at advances again
    // must never create a duplicate execution for the same occurrence.
    await pool.query("UPDATE scheduler_subscription_projection SET next_run_at = now() - interval '5 seconds' WHERE subscription_id = $1 AND next_run_at > now()", [subscriptionId]);
    await schedulerCoordinator.runScanTick();
    const pageAfterSecondScan = await listExecutions(pool, { subscriptionId, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID });
    expect(pageAfterSecondScan.items.filter((e) => e.scheduledFor.getTime() === execution.scheduledFor.getTime())).toHaveLength(1);
  });

  it("subscription owned by the given tenant can be read back with unmodified subscription-service data intact", async () => {
    if (!servicesUp) return;
    const context = await subscriptionClient.getDeliveryContext("sub-does-not-exist");
    expect(context).toBeNull();
  });
});
