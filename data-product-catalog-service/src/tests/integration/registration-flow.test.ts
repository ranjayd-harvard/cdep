import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../setup/test-helpers.js";

// End-to-end exercise of spec §61's worked compatibility example plus
// registration idempotency (§17), activation (§20), and retirement (§57)
// — against a real running Postgres (see vitest.config.ts / README "Running
// the tests"). Each run uses a fresh random domain/owner/product id triple
// so the suite is safe to re-run without resetting the database.
describe("contract registration → activation → lifecycle", () => {
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
        delivery: { methods: [{ type: "FILE", enabled: true, formats: ["PARQUET", "CSV"] }] },
        sla: { freshnessMinutes: 240, availabilityTargetPercent: 99.9, maximumPublicationLatencyMinutes: 30 },
        quality: { minimumCompletenessPercent: 99, grainUniqueRequired: true },
        publication: { defaultFormat: "PARQUET", expirationHours: 168, filenamePattern: "test-{date}-{publicationId}" },
      },
    };
  }

  const v1Schema = [
    { name: "event_id", type: "string", required: true, grainKey: true },
    { name: "venue_id", type: "string", required: true },
    { name: "event_date", type: "date", required: true },
    { name: "internal_pipeline_run_id", type: "string", required: false, customerVisible: false, classification: "INTERNAL" },
  ];

  beforeAll(async () => {
    app = await createTestApp();
    await app.inject({
      method: "POST",
      url: "/internal/v1/domains",
      payload: { domainId, name: domainId, displayName: "Test Domain" },
    });
    await app.inject({
      method: "POST",
      url: "/internal/v1/owners",
      payload: { ownerId, ownerType: "TEAM", name: "Test Owner" },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers the first version (1.0.0) successfully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.0.0", v1Schema), source: { repository: "test-repo", path: "contracts/test.yaml", commit: "abc123" } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.registration).toBe("SUCCESS");
    expect(body.compatibility).toBe("NON_BREAKING");
    expect(body.contractHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent on an exact duplicate registration", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.0.0", v1Schema) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().registration).toBe("DUPLICATE");
  });

  it("accepts an additive nullable field as a NON_BREAKING minor bump (1.1.0)", async () => {
    const schema = [...v1Schema, { name: "revenue_per_ticket", type: "decimal(18,2)", required: false }];
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.1.0", schema) },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().compatibility).toBe("NON_BREAKING");
  });

  it("rejects a breaking field removal declared as only a minor bump (1.2.0)", async () => {
    const schema = v1Schema.filter((f) => f.name !== "venue_id");
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.2.0", schema) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("BREAKING_CHANGE_REQUIRES_MAJOR_VERSION");
  });

  it("accepts the same breaking field removal as a major bump (2.0.0)", async () => {
    const schema = v1Schema.filter((f) => f.name !== "venue_id");
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("2.0.0", schema) },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().compatibility).toBe("BREAKING");
  });

  it("does not activate automatically on registration", async () => {
    const res = await app.inject({ method: "GET", url: `/internal/v1/data-products/${productId}/active-version` });
    expect(res.statusCode).toBe(404);
  });

  it("activates 1.0.0, then 1.1.0 supersedes it", async () => {
    const first = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/activate` });
    expect(first.statusCode).toBe(200);

    let active = await app.inject({ method: "GET", url: `/internal/v1/data-products/${productId}/active-version` });
    expect(active.json().version).toBe("1.0.0");

    const second = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.1.0/activate` });
    expect(second.statusCode).toBe(200);

    active = await app.inject({ method: "GET", url: `/internal/v1/data-products/${productId}/active-version` });
    expect(active.json().version).toBe("1.1.0");

    const history = await app.inject({ method: "GET", url: `/v1/data-products/${productId}/versions` });
    const v1 = history.json().items.find((v: { version: string }) => v.version === "1.0.0");
    expect(v1.lifecycleStatus).toBe("DEPRECATED");
  });

  it("exposes the active version and customer-safe schema via the customer API", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/data-products/${productId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activeVersion.version).toBe("1.1.0");
    const fieldNames = body.activeVersion.schema.map((f: { name: string }) => f.name);
    expect(fieldNames).toContain("venue_id");
    expect(fieldNames).not.toContain("internal_pipeline_run_id");
  });

  it("returns the full normalized contract, internal-only fields included, from the internal contract API", async () => {
    const res = await app.inject({ method: "GET", url: `/internal/v1/data-products/${productId}/versions/1.1.0/contract` });
    expect(res.statusCode).toBe(200);
    const names = res.json().contract.spec.schema.map((f: { name: string }) => f.name);
    expect(names).toContain("internal_pipeline_run_id");
  });

  it("cannot retire the active version without force", async () => {
    const res = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.1.0/retire` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("VERSION_NOT_RETIRABLE");
  });

  it("retires a deprecated (non-active) version freely", async () => {
    const res = await app.inject({ method: "POST", url: `/internal/v1/data-products/${productId}/versions/1.0.0/retire` });
    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycleStatus).toBe("RETIRED");
  });

  it("finds the product via search", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/data-products?search=${encodeURIComponent("Test Product")}` });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((p: { dataProductId: string }) => p.dataProductId);
    expect(ids).toContain(productId);
  });
});
