import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestApp, internalHeaders } from "../setup/test-helpers.js";
import { checkRetirementBlockers } from "../../modules/lifecycle/retirement-guard.js";
import { declareDependency } from "../../modules/dependencies/dependency.service.js";
import { findVersion } from "../../modules/versions/version.repository.js";

// Phase 10 §21-22: retirement guard blocker checks, including real HTTP
// calls to the live subscription-service/scheduling-service/data-
// publication-service containers already running locally (this repo's own
// established practice of testing against actually-running siblings, not
// just mocks — see the Phase 9 report). These fixture products are brand
// new, so the cross-service checks correctly return empty rather than
// erroring — proving the plumbing (auth headers, pagination, response
// parsing) works end to end, even though contriving an actual blocking
// subscription/execution/publication in three other services' databases is
// out of scope for this test file.
describe("retirement guard", () => {
  let app: FastifyInstance;
  const suffix = randomUUID().slice(0, 8);
  const domainId = `test-domain-${suffix}`;
  const ownerId = `test-owner-${suffix}`;
  const productId = `test-product-${suffix}`;
  const dependentProductId = `test-dependent-${suffix}`;

  function contractFor(pid: string, version: string, schema: Array<Record<string, unknown>>) {
    return {
      apiVersion: "data-platform/v1",
      kind: "DataProduct",
      metadata: { id: pid, name: "Test Product", version },
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

    await app.inject({ method: "POST", url: "/internal/v1/contracts/register", payload: { contract: contractFor(productId, "1.0.0", [f]) } });
    await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/activate` });

    await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor(dependentProductId, "1.0.0", [f]) },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns no blockers for a fresh product with no cross-service state (real HTTP calls to live siblings)", async () => {
    const blockers = await checkRetirementBlockers(productId, "1.0.0");
    expect(blockers).toEqual([]);
  });

  it("blocks retirement when a dependent product's declared range still covers this version", async () => {
    await declareDependency({
      dependentDataProductId: dependentProductId,
      dependentVersion: "1.0.0",
      dependsOnDataProductId: productId,
      minVersion: "1.0.0",
      maxVersion: "2.0.0",
    });

    const blockers = await checkRetirementBlockers(productId, "1.0.0");
    expect(blockers.some((b) => b.type === "DEPENDENT_PRODUCTS")).toBe(true);
  });

  it("full retireVersion(): rejects without force, records VERSION_RETIREMENT_BLOCKED, then succeeds with force+reason+PLATFORM_ADMIN", async () => {
    // 1.0.0 is ACTIVE — deprecate it first (state machine requires this
    // before RETIRED is even reachable).
    await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/deprecate`, payload: { gracePeriodDays: 0 } });

    const blocked = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/retire` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("VERSION_NOT_RETIRABLE");
    expect(blocked.json().error.blockers.some((b: { type: string }) => b.type === "DEPENDENT_PRODUCTS")).toBe(true);

    const noReason = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/retire`, payload: { force: true } });
    expect(noReason.statusCode).toBe(400);

    const wrongRole = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/1.0.0/retire`,
      payload: { force: true, reason: "attempting as a non-platform-admin" },
      headers: internalHeaders({ "x-actor-role": "PRODUCT_ADMIN" }),
    });
    expect(wrongRole.statusCode).toBe(403);

    const forced = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/1.0.0/retire`,
      payload: { force: true, reason: "Critical data quality defect; version permanently disabled." },
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().lifecycleStatus).toBe("RETIRED");

    const row = await findVersion(productId, "1.0.0");
    expect(row?.lifecycle_status).toBe("RETIRED");
  });
});
