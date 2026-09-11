import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../setup/test-helpers.js";
import { findVersion } from "../../modules/versions/version.repository.js";

// Phase 10 §33: ACTIVE -> DEPRECATED -> rollback -> ACTIVE again, with
// history rows intact and the correct event type (never VERSION_ACTIVATED).
describe("rollback", () => {
  let app: FastifyInstance;
  const suffix = randomUUID().slice(0, 8);
  const domainId = `test-domain-${suffix}`;
  const ownerId = `test-owner-${suffix}`;
  const productId = `test-product-${suffix}`;

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

  beforeAll(async () => {
    app = await createTestApp();
    await app.inject({ method: "POST", url: "/internal/v1/domains", payload: { domainId, name: domainId, displayName: "Test Domain" } });
    await app.inject({ method: "POST", url: "/internal/v1/owners", payload: { ownerId, ownerType: "TEAM", name: "Test Owner" } });
  });

  afterAll(async () => {
    await app.close();
  });

  it("rolls back to the immediate predecessor without rewriting history", async () => {
    await app.inject({ method: "POST", url: "/internal/v1/contracts/register", payload: { contract: contractFor("1.0.0", [f]) } });
    await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/activate` });

    await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.1.0", [f, { name: "extra", type: "string", required: false }]) },
    });
    await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.1.0/activate` });

    // Emergency problem detected with 1.1.0 — roll back.
    const rollback = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/1.0.0/rollback`,
      payload: { reason: "1.1.0 caused a production incident" },
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().lifecycleStatus).toBe("ACTIVE");

    const rolledBack = await findVersion(productId, "1.0.0");
    expect(rolledBack?.lifecycle_status).toBe("ACTIVE");
    expect(rolledBack?.successor_version).toBe("1.1.0");

    const failedVersion = await findVersion(productId, "1.1.0");
    expect(failedVersion?.lifecycle_status).toBe("DEPRECATED"); // demoted, not deleted
    expect(failedVersion?.grace_period_end).not.toBeNull();

    const activeCheck = await app.inject({ method: "GET", url: `/internal/v1/data-products/${productId}/active-version` });
    expect(activeCheck.json().version).toBe("1.0.0");
  });

  it("rejects rolling back a version that isn't the immediate predecessor of the current ACTIVE version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/1.1.0/rollback`, // 1.1.0 is DEPRECATED, not ACTIVE's predecessor (1.0.0 is ACTIVE now)
    });
    expect(res.statusCode).toBe(409);
  });
});
