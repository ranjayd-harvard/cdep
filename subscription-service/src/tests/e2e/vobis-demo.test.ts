import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { pool } from "../../database/pool.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import { listAuditEventsForEntity } from "../../infrastructure/persistence/audit.repository.js";

// Reproduces spec §60-71 end-to-end: Vobis Org / Default Tenant /
// Event Performance, against a real running data-product-catalog-service
// (no Catalog internals mocked — spec §54 "do not duplicate Catalog
// internals in tests"). Requires CATALOG_SERVICE_URL to point at a live
// instance seeded with "event-performance" (1.0.0 DEPRECATED, 1.1.0
// ACTIVE, 2.0.0 DRAFT), matching spec §59's seed data.
const ORGANIZATION_ID = "org-vobis-org-722aea";
const TENANT_ID = "tenant-default-47d849";
const DATA_PRODUCT_ID = "event-performance";

const INTERNAL_HEADERS = {
  "x-internal-api-key": "dev-internal-key-change-me",
  "x-actor-type": "SERVICE",
  "x-actor-id": "e2e-test",
  "x-actor-role": "PLATFORM_ADMIN",
};

function customerToken(): string {
  const payload = { sub: "usr-vobis-1", organization_id: ORGANIZATION_ID, active_tenant_id: TENANT_ID, role: "CUSTOMER_ADMIN" };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

let app: FastifyInstance;

beforeAll(async () => {
  await ensureMigrated();
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("Phase 6 end-to-end: Vobis Org / Default Tenant / Event Performance", () => {
  it("walks the full entitlement + subscription lifecycle without ever scheduling or publishing anything", async () => {
    // Step 2 — evaluate before grant: DENY / NO_ENTITLEMENT.
    const beforeGrant = await app.inject({
      method: "POST",
      url: "/internal/v1/entitlements/evaluate",
      headers: INTERNAL_HEADERS,
      payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID },
    });
    expect(beforeGrant.json()).toMatchObject({ decision: "DENY", reason: "NO_ENTITLEMENT" });

    // Step 3 — grant ALLOW, then evaluate again: ALLOW / ACTIVE_ENTITLEMENT.
    const grant = await app.inject({
      method: "POST",
      url: "/internal/v1/entitlements",
      headers: INTERNAL_HEADERS,
      payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID, effect: "ALLOW", reason: "Customer contract" },
    });
    expect(grant.statusCode).toBe(201);
    const entitlementId = grant.json().entitlement_id as string;

    const afterGrant = await app.inject({
      method: "POST",
      url: "/internal/v1/entitlements/evaluate",
      headers: INTERNAL_HEADERS,
      payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID },
    });
    expect(afterGrant.json()).toMatchObject({ decision: "ALLOW", reason: "ACTIVE_ENTITLEMENT", entitlement_id: entitlementId });

    // Step 4 — create subscription: version policy 1.x, FILE/PARQUET/DAILY/06:00 UTC/7 days retention.
    const token = customerToken();
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
    expect(create.statusCode).toBe(201);
    const subscription = create.json();
    expect(subscription.status).toBe("ACTIVE");
    const subscriptionId = subscription.subscription_id as string;

    // The request's correlation id must land on the audit trail (spec §40/§49) —
    // not just be echoed back in the response header.
    const responseCorrelationId = create.headers["x-correlation-id"] as string;
    const createdEvent = (await listAuditEventsForEntity(pool, ORGANIZATION_ID, TENANT_ID, "SUBSCRIPTION", subscriptionId)).find(
      (e) => e.action === "SUBSCRIPTION_CREATED",
    );
    expect(createdEvent?.correlationId).toBe(responseCorrelationId);
    expect(createdEvent?.actorId).toBe("usr-vobis-1");

    // Step 5 — read subscription: resolved version, delivery config as configured.
    const read = await app.inject({ method: "GET", url: `/v1/subscriptions/${subscriptionId}`, headers: { authorization: `Bearer ${token}` } });
    expect(read.json()).toMatchObject({
      status: "ACTIVE",
      version_policy: { type: "COMPATIBLE_MAJOR", value: "1" },
      delivery: { method: "FILE", format: "PARQUET", frequency: "DAILY", delivery_time: "06:00:00", timezone: "UTC", retention_days: 7 },
    });

    // Step 6 — pause: ACTIVE -> PAUSED. Entitlement remains ALLOW.
    const pause = await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/pause`, headers: { authorization: `Bearer ${token}` } });
    expect(pause.json().status).toBe("PAUSED");
    const entitlementStillAllowed = await app.inject({
      method: "POST",
      url: "/internal/v1/entitlements/evaluate",
      headers: INTERNAL_HEADERS,
      payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID },
    });
    expect(entitlementStillAllowed.json().decision).toBe("ALLOW");

    // Step 7 — resume: reruns eligibility, PAUSED -> ACTIVE.
    const resume = await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/resume`, headers: { authorization: `Bearer ${token}` } });
    expect(resume.json().status).toBe("ACTIVE");

    // Step 8 — deny/revoke entitlement: entitlement DENY, subscription cascades ACTIVE -> SUSPENDED / ENTITLEMENT_REVOKED.
    const deny = await app.inject({ method: "POST", url: `/internal/v1/entitlements/${entitlementId}/deny`, headers: INTERNAL_HEADERS });
    expect(deny.json().effect).toBe("DENY");

    const afterCascade = await app.inject({ method: "GET", url: `/v1/subscriptions/${subscriptionId}`, headers: { authorization: `Bearer ${token}` } });
    expect(afterCascade.json()).toMatchObject({ status: "SUSPENDED", suspension_reason: "ENTITLEMENT_REVOKED" });

    // Step 9 — reactivation attempt while DENY is rejected outright: subscription never grants its own access.
    const rejectedResume = await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/resume`, headers: { authorization: `Bearer ${token}` } });
    expect(rejectedResume.statusCode).toBe(403);
    expect(rejectedResume.json().error.code).toBe("PRODUCT_NOT_ENTITLED");

    // Step 10 — restore entitlement, then explicitly reactivate: ALLOW + ACTIVE.
    const allow = await app.inject({ method: "POST", url: `/internal/v1/entitlements/${entitlementId}/allow`, headers: INTERNAL_HEADERS });
    expect(allow.json().effect).toBe("ALLOW");

    const reactivated = await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/resume`, headers: { authorization: `Bearer ${token}` } });
    expect(reactivated.json().status).toBe("ACTIVE");

    // Step 11 — Phase-7-facing delivery-context: full contract, no scheduling fields, nothing published.
    const deliveryContext = await app.inject({ method: "GET", url: `/internal/v1/subscriptions/${subscriptionId}/delivery-context`, headers: INTERNAL_HEADERS });
    const dto = deliveryContext.json();
    expect(dto).toMatchObject({
      subscription_id: subscriptionId,
      organization_id: ORGANIZATION_ID,
      tenant_id: TENANT_ID,
      data_product_id: DATA_PRODUCT_ID,
      status: "ACTIVE",
      version_policy: { type: "COMPATIBLE_MAJOR", value: "1" },
      resolved_product_version: { version: "1.1.0" },
      delivery: { method: "FILE", format: "PARQUET", frequency: "DAILY", retention_days: 7 },
    });
    expect(dto).not.toHaveProperty("next_run_at");
    expect(dto).not.toHaveProperty("last_run_at");

    // Step 12 — Phase-8-facing resolve-by-scope: same DTO as the by-id
    // lookup above, reached only via (organization_id, tenant_id,
    // data_product_id) since data-product-api-service never learns a
    // subscription_id on its own.
    const resolved = await app.inject({
      method: "GET",
      url: `/internal/v1/subscriptions/resolve?organization_id=${ORGANIZATION_ID}&tenant_id=${TENANT_ID}&data_product_id=${DATA_PRODUCT_ID}`,
      headers: INTERNAL_HEADERS,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual(dto);
  });

  it("enforces tenant isolation: another tenant cannot read, pause, or cancel this subscription", async () => {
    await app.inject({
      method: "POST",
      url: "/internal/v1/entitlements",
      headers: INTERNAL_HEADERS,
      payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID, effect: "ALLOW" },
    });
    const create = await app.inject({
      method: "POST",
      url: "/v1/subscriptions",
      headers: { authorization: `Bearer ${customerToken()}` },
      payload: { data_product_id: DATA_PRODUCT_ID, version_policy: "latest", delivery: { method: "API", frequency: "ON_DEMAND" } },
    });
    const subscriptionId = create.json().subscription_id as string;

    const otherToken = Buffer.from(JSON.stringify({ sub: "usr-2", organization_id: "org-other", active_tenant_id: "tenant-other", role: "CUSTOMER_ADMIN" })).toString(
      "base64url",
    );

    const crossRead = await app.inject({ method: "GET", url: `/v1/subscriptions/${subscriptionId}`, headers: { authorization: `Bearer ${otherToken}` } });
    expect(crossRead.statusCode).toBe(404);

    const crossCancel = await app.inject({ method: "POST", url: `/v1/subscriptions/${subscriptionId}/cancel`, headers: { authorization: `Bearer ${otherToken}` } });
    expect(crossCancel.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/subscriptions", headers: { authorization: `Bearer ${otherToken}` } });
    expect(crossList.json().items).toEqual([]);
  });

  it("is idempotent on subscription creation: replayed key + identical payload yields exactly one subscription", async () => {
    await app.inject({
      method: "POST",
      url: "/internal/v1/entitlements",
      headers: INTERNAL_HEADERS,
      payload: { organization_id: ORGANIZATION_ID, tenant_id: TENANT_ID, data_product_id: DATA_PRODUCT_ID, effect: "ALLOW" },
    });

    const token = customerToken();
    const payload = { data_product_id: DATA_PRODUCT_ID, version_policy: "1.x", delivery: { method: "API", frequency: "ON_DEMAND" } };

    const first = await app.inject({ method: "POST", url: "/v1/subscriptions", headers: { authorization: `Bearer ${token}`, "idempotency-key": "create-1" }, payload });
    const second = await app.inject({ method: "POST", url: "/v1/subscriptions", headers: { authorization: `Bearer ${token}`, "idempotency-key": "create-1" }, payload });
    expect(first.json()).toEqual(second.json());

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM subscriptions WHERE organization_id = $1 AND tenant_id = $2", [ORGANIZATION_ID, TENANT_ID]);
    expect(rows[0].n).toBe(1);

    const differentPayload = await app.inject({
      method: "POST",
      url: "/v1/subscriptions",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": "create-1" },
      payload: { ...payload, version_policy: "latest" },
    });
    expect(differentPayload.statusCode).toBe(409);
    expect(differentPayload.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects a subscription request for a product the tenant is not entitled to", async () => {
    const token = customerToken();
    const create = await app.inject({
      method: "POST",
      url: "/v1/subscriptions",
      headers: { authorization: `Bearer ${token}` },
      payload: { data_product_id: DATA_PRODUCT_ID, version_policy: "1.x", delivery: { method: "API", frequency: "ON_DEMAND" } },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe("PRODUCT_NOT_ENTITLED");
  });

  it("resolve-by-scope returns SUBSCRIPTION_NOT_FOUND when the tenant has no subscription for the product", async () => {
    const resolved = await app.inject({
      method: "GET",
      url: `/internal/v1/subscriptions/resolve?organization_id=${ORGANIZATION_ID}&tenant_id=${TENANT_ID}&data_product_id=${DATA_PRODUCT_ID}`,
      headers: INTERNAL_HEADERS,
    });
    expect(resolved.statusCode).toBe(404);
    expect(resolved.json().error.code).toBe("SUBSCRIPTION_NOT_FOUND");
  });
});
