import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

// Phase 10 §52/§53's acceptance trace, narrowed to the link this phase's
// verification pass found the original spec missed: does a REAL scheduling-
// service manual trigger — going through the exact same
// ExecutionProcessor.run() pipeline a scheduled occurrence would — resolve
// the subscriber's policy via Catalog's centralized resolver (not
// scheduling-service's own, now-deleted, duplicate ranking algorithm) and
// report the same version Catalog itself would independently resolve.
//
// Against REAL running data-product-catalog-service and subscription-
// service (same "no internals re-implemented in tests" discipline as
// vobis-demo.test.ts). Deliberately does not assert on Publication Service
// success — a synthetic test product has no real Lakehouse Gold data, so
// the pipeline may fail *after* version resolution; resolved_product_version
// is set and returned regardless of the eventual dispatch outcome, which is
// exactly what this test needs to check.
const CATALOG_URL = process.env.CATALOG_SERVICE_URL ?? "http://localhost:8092";
const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_SERVICE_URL ?? "http://localhost:8093";
const SCHEDULING_URL = "http://localhost:8094";

const suffix = randomUUID().slice(0, 8);
const domainId = `test-domain-${suffix}`;
const ownerId = `test-owner-${suffix}`;
const productId = `test-product-${suffix}`;
const orgId = `org-p10e2e-${suffix}`;
const tenantId = `tenant-p10e2e-${suffix}`;

function contractFor(version: string, schema: Array<Record<string, unknown>>) {
  return {
    apiVersion: "data-platform/v1",
    kind: "DataProduct",
    metadata: { id: productId, name: "Test Product", version },
    spec: {
      domain: { id: domainId },
      owner: { id: ownerId, displayName: "Test Owner" },
      grain: { description: "One row per event", keys: ["event_id"] },
      schema,
      delivery: { methods: [{ type: "FILE", enabled: true, formats: ["PARQUET"] }] },
      sla: { freshnessMinutes: 240 },
      quality: { grainUniqueRequired: true },
      publication: {},
    },
  };
}
const f = { name: "event_id", type: "string", required: true, grainKey: true };

function customerToken(): string {
  const payload = { sub: "usr-p10e2e", organization_id: orgId, active_tenant_id: tenantId, role: "CUSTOMER_ADMIN" };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

async function liveServicesReachable(): Promise<boolean> {
  try {
    const results = await Promise.all(
      [CATALOG_URL, SUBSCRIPTION_URL, SCHEDULING_URL].map((url) => fetch(`${url}/health/live`).then((r) => r.ok)),
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
}

describe("Phase 10 e2e: centralized resolver agreement across Subscription + Scheduling", () => {
  it("scheduling-service's manual trigger resolves the same version Catalog's resolver would, via the shared endpoint", async () => {
    if (!(await liveServicesReachable())) {
      console.warn("Skipping: catalog-service/subscription-service/scheduling-service are not all reachable.");
      return;
    }

    await fetch(`${CATALOG_URL}/internal/v1/domains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId, name: domainId, displayName: "Test Domain" }),
    });
    await fetch(`${CATALOG_URL}/internal/v1/owners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId, ownerType: "TEAM", name: "Test Owner" }),
    });

    // 1.0.0 -> ACTIVE, then 1.1.0 (non-breaking) -> ACTIVE (supersedes 1.0.0).
    for (const v of ["1.0.0", "1.1.0"]) {
      await fetch(`${CATALOG_URL}/internal/v1/contracts/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract: contractFor(v, [f]) }),
      });
      await fetch(`${CATALOG_URL}/internal/v1/data-products/${productId}/versions/${v}/activate`, { method: "POST" });
    }

    // Independently ask Catalog's resolver what a COMPATIBLE_MINOR("1")
    // policy should resolve to right now — the ground truth this test
    // checks the scheduler's own resolution against.
    const directResolve = await fetch(`${CATALOG_URL}/internal/v1/data-products/${productId}/resolve-version`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": "dev-internal-key-change-me",
        "x-actor-type": "SERVICE",
        "x-actor-id": "e2e-test",
        "x-actor-role": "CATALOG_READER",
      },
      body: JSON.stringify({ policy: { type: "COMPATIBLE_MINOR", value: "1" }, intent: "DELIVER" }),
    });
    expect(directResolve.ok).toBe(true);
    const { resolved_version: expectedVersion } = (await directResolve.json()) as { resolved_version: string };
    expect(expectedVersion).toBe("1.1.0");

    // Real entitlement + subscription in subscription-service.
    await fetch(`${SUBSCRIPTION_URL}/internal/v1/entitlements`, {
      method: "POST",
      headers: {
        "x-internal-api-key": "dev-internal-key-change-me",
        "x-actor-type": "SERVICE",
        "x-actor-id": "e2e-test",
        "x-actor-role": "PLATFORM_ADMIN",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organization_id: orgId, tenant_id: tenantId, data_product_id: productId, effect: "ALLOW", reason: "e2e" }),
    });
    const subRes = await fetch(`${SUBSCRIPTION_URL}/v1/subscriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${customerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data_product_id: productId,
        version_policy: "1.x", // parses to COMPATIBLE_MINOR("1")
        delivery: { method: "FILE", format: "PARQUET", frequency: "ON_DEMAND" },
      }),
    });
    expect(subRes.status).toBe(201);
    const subscription = (await subRes.json()) as { subscription_id: string };

    // The actual link under test: scheduling-service's own manual trigger,
    // running the real ExecutionProcessor.run() pipeline synchronously.
    const triggerRes = await fetch(`${SCHEDULING_URL}/internal/scheduler/subscriptions/${subscription.subscription_id}/trigger`, {
      method: "POST",
      headers: {
        "x-internal-api-key": "dev-internal-key-change-me",
        "x-actor-type": "SERVICE",
        "x-actor-id": "e2e-test",
        "x-actor-role": "SCHEDULER_ADMIN",
      },
    });
    expect([200, 202]).toContain(triggerRes.status);
    const execution = (await triggerRes.json()) as { resolved_product_version: string | null };

    // The load-bearing assertion: scheduling-service's resolution (via the
    // now-fixed catalog-http-client.ts calling Catalog's shared resolver)
    // agrees exactly with what Catalog's resolver returned directly above
    // — proving the duplicate/stale local ranking algorithm this phase
    // found and removed is no longer in the loop.
    expect(execution.resolved_product_version).toBe(expectedVersion);
  });
});
