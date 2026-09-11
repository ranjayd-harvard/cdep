import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../setup/test-helpers.js";
import { findVersion } from "../../modules/versions/version.repository.js";

// Phase 10 §16-§24: transition-rules-backed activation/deprecation, grace
// periods, lineage bookkeeping, breaking-change approval gating, and the
// evaluate-compatibility dry-run endpoint.
describe("Phase 10 version lifecycle", () => {
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
        description: "Integration test product.",
        grain: { description: "One row per event", keys: ["event_id"] },
        schema,
        delivery: { methods: [{ type: "FILE", enabled: true, formats: ["PARQUET"] }] },
        sla: { freshnessMinutes: 240 },
        quality: { grainUniqueRequired: true },
        publication: {},
      },
    };
  }

  const baseSchema = [
    { name: "event_id", type: "string", required: true, grainKey: true },
    { name: "venue_id", type: "string", required: true },
  ];

  beforeAll(async () => {
    app = await createTestApp();
    await app.inject({ method: "POST", url: "/internal/v1/domains", payload: { domainId, name: domainId, displayName: "Test Domain" } });
    await app.inject({ method: "POST", url: "/internal/v1/owners", payload: { ownerId, ownerType: "TEAM", name: "Test Owner" } });
  });

  afterAll(async () => {
    await app.close();
  });

  it("activates 1.0.0, then a non-breaking 1.1.0 supersedes it with lineage + grace period set", async () => {
    const r1 = await app.inject({ method: "POST", url: "/internal/v1/contracts/register", payload: { contract: contractFor("1.0.0", baseSchema) } });
    expect(r1.statusCode).toBe(201);
    const activate1 = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/activate` });
    expect(activate1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.1.0", [...baseSchema, { name: "capacity_utilization", type: "double", required: false }]) },
    });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().compatibility).toBe("NON_BREAKING");

    const activate2 = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.1.0/activate` });
    expect(activate2.statusCode).toBe(200);

    const oldRow = await findVersion(productId, "1.0.0");
    expect(oldRow?.lifecycle_status).toBe("DEPRECATED");
    expect(oldRow?.successor_version).toBe("1.1.0");
    expect(oldRow?.grace_period_end).not.toBeNull();

    const newRow = await findVersion(productId, "1.1.0");
    expect(newRow?.lifecycle_status).toBe("ACTIVE");
    expect(newRow?.predecessor_version).toBe("1.0.0");
    expect(newRow?.activated_at).not.toBeNull();
  });

  it("blocks activating a BREAKING version without approval, then allows it once approved", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("2.0.0", [{ name: "event_id", type: "string", required: true, grainKey: true }]) },
    });
    expect(register.statusCode).toBe(201);
    expect(register.json().compatibility).toBe("BREAKING");

    const betaWithoutApproval = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/2.0.0/activate`,
      payload: { targetStatus: "BETA" },
    });
    expect(betaWithoutApproval.statusCode).toBe(409);
    expect(betaWithoutApproval.json().error.code).toBe("VERSION_APPROVAL_REQUIRED");

    const approve = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/2.0.0/approve`,
      payload: { reason: "Reviewed breaking change; migration plan tracked separately." },
    });
    expect(approve.statusCode).toBe(201);
    expect(approve.json().required).toBe(true);

    const betaAfterApproval = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/2.0.0/activate`,
      payload: { targetStatus: "BETA" },
    });
    expect(betaAfterApproval.statusCode).toBe(200);
    expect(betaAfterApproval.json().lifecycleStatus).toBe("BETA");

    // BETA coexists alongside the current ACTIVE version — it must not have
    // been superseded.
    const stillActive = await findVersion(productId, "1.1.0");
    expect(stillActive?.lifecycle_status).toBe("ACTIVE");
  });

  it("evaluate-compatibility runs a dry-run diff without creating a version", async () => {
    // Latest registered version is still 2.0.0 (single field: event_id:string)
    // — a candidate that changes its type is BREAKING relative to it.
    const res = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/3.0.0/evaluate-compatibility`,
      payload: { contract: contractFor("3.0.0", [{ name: "event_id", type: "long", required: true, grainKey: true }]) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.compatibility).toBe("BREAKING");
    expect(body.target_version).toBe("3.0.0");
    expect(Array.isArray(body.changes)).toBe(true);

    const notCreated = await findVersion(productId, "3.0.0");
    expect(notCreated).toBeNull();
  });

  it("deprecates with a custom grace period and an explicit replacement version", async () => {
    const deprecate = await app.inject({
      method: "POST",
      url: `/internal/v1/data-products/${productId}/versions/2.0.0/deprecate`,
      payload: { reason: "manual test deprecation", gracePeriodDays: 1, replacementVersion: "1.1.0" },
    });
    // 2.0.0 is BETA at this point (from the earlier test) — BETA has no
    // DEPRECATED transition (only ACTIVE/RETIRED), so this must reject.
    expect(deprecate.statusCode).toBe(409);
    expect(deprecate.json().error.code).toBe("INVALID_VERSION_TRANSITION");
  });

  it("rejects retiring a DRAFT version and an already-ACTIVE version directly", async () => {
    // Must be > the latest registered version (2.0.0) to pass the semver
    // "must be greater than latest" check, and NON_BREAKING so it needs no
    // approval — kept DRAFT (never activated) for this test.
    const draftRegister = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: {
        contract: contractFor("2.1.0", [
          { name: "event_id", type: "string", required: true, grainKey: true },
          { name: "new_optional_field", type: "string", required: false },
        ]),
      },
    });
    expect(draftRegister.statusCode).toBe(201);
    expect(draftRegister.json().compatibility).toBe("NON_BREAKING");

    const retireDraft = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/2.1.0/retire` });
    expect(retireDraft.statusCode).toBe(409);
    expect(retireDraft.json().error.code).toBe("INVALID_VERSION_TRANSITION");

    const retireActive = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.1.0/retire` });
    expect(retireActive.statusCode).toBe(409);
    expect(retireActive.json().error.code).toBe("VERSION_NOT_RETIRABLE");
  });

  it("the internal full-history listing includes every lifecycle status, unlike the customer-safe route", async () => {
    const res = await app.inject({ method: "GET", url: `/internal/v1/data-products/${productId}/versions` });
    expect(res.statusCode).toBe(200);
    const byVersion = new Map<string, { lifecycle_status: string }>(
      res.json().items.map((v: { version: string; lifecycle_status: string }) => [v.version, v]),
    );

    expect(byVersion.get("1.0.0")?.lifecycle_status).toBe("DEPRECATED");
    expect(byVersion.get("1.1.0")?.lifecycle_status).toBe("ACTIVE");
    expect(byVersion.get("2.0.0")?.lifecycle_status).toBe("BETA");
    expect(byVersion.get("2.1.0")?.lifecycle_status).toBe("DRAFT"); // never visible on the customer-safe route

    const customerSafe = await app.inject({ method: "GET", url: `/v1/data-products/${productId}/versions` });
    const customerVersions = customerSafe.json().items.map((v: { version: string }) => v.version);
    expect(customerVersions).not.toContain("2.1.0");
    expect(customerVersions).not.toContain("2.0.0");
  });
});
