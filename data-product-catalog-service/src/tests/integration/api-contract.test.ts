import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../setup/test-helpers.js";

// Phase 8 (spec §8.2): the Contract-driven API query policy that
// data-product-api-service resolves before running any serving-store
// query. Reuses the same registration pipeline as every other contract —
// no second API-specific registry.
describe("GET /internal/v1/versions/api-contract", () => {
  let app: FastifyInstance;
  const suffix = randomUUID().slice(0, 8);
  const domainId = `test-domain-${suffix}`;
  const ownerId = `test-owner-${suffix}`;
  const productId = `test-product-${suffix}`;

  function contractFor(version: string, deliveryMethods: Array<Record<string, unknown>>, forProductId: string = productId) {
    return {
      apiVersion: "data-platform/v1",
      kind: "DataProduct",
      metadata: { id: forProductId, name: "Test Product", version },
      spec: {
        domain: { id: domainId },
        owner: { id: ownerId, displayName: "Test Owner" },
        description: "Integration test product.",
        grain: { description: "One row per event", keys: ["event_id"] },
        schema: [
          { name: "event_id", type: "string", required: true, grainKey: true },
          { name: "venue_id", type: "string", required: true },
          { name: "event_date", type: "date", required: true },
          { name: "internal_pipeline_run_id", type: "string", required: false, customerVisible: false, classification: "INTERNAL" },
        ],
        delivery: { methods: deliveryMethods },
        sla: { freshnessMinutes: 240 },
        quality: { grainUniqueRequired: true },
        publication: {},
      },
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.inject({ method: "POST", url: "/internal/v1/domains", payload: { domainId, name: domainId, displayName: "Test Domain" } });
    await app.inject({ method: "POST", url: "/internal/v1/owners", payload: { ownerId, ownerType: "TEAM", name: "Test Owner" } });
  });

  afterAll(async () => {
    await app.close();
  });

  it("resolves the API query policy and strips non-customer-visible fields", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: {
        contract: contractFor("1.0.0", [
          {
            type: "API",
            enabled: true,
            api: {
              resource: "events",
              filters: ["event_id", "venue_id"],
              sorts: ["event_date", "event_id"],
              defaultSort: ["event_date", "event_id"],
              defaultPageSize: 100,
              maxPageSize: 500,
            },
          },
        ]),
      },
    });
    expect(register.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: `/internal/v1/versions/api-contract?data_product_id=${productId}&version=1.0.0`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      data_product_id: productId,
      version: "1.0.0",
      resource: "events",
      filters: ["event_id", "venue_id"],
      sorts: ["event_date", "event_id"],
      default_page_size: 100,
      max_page_size: 500,
      freshness_minutes: 240,
    });
    const fieldNames = (body.published_fields as Array<{ name: string }>).map((f) => f.name);
    expect(fieldNames).toEqual(["event_id", "venue_id", "event_date"]);
    expect(fieldNames).not.toContain("internal_pipeline_run_id");
  });

  it("rejects a version with no API delivery method configured", async () => {
    // A fresh product (not a second version of `productId`) — removing the
    // API delivery method from an *existing* version is itself a BREAKING
    // change under Phase 10's delivery-method compatibility diff (spec
    // §17), which is exercised separately below. This test is only about
    // the api-contract read endpoint's behavior for a version that never
    // had API delivery configured in the first place.
    const noApiProductId = `${productId}-no-api`;
    const register = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.0.0", [{ type: "FILE", enabled: true, formats: ["PARQUET"] }], noApiProductId) },
    });
    expect(register.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: `/internal/v1/versions/api-contract?data_product_id=${noApiProductId}&version=1.0.0`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("API_DELIVERY_NOT_CONFIGURED");
  });

  it("rejects removing a published delivery method without a major version bump", async () => {
    const removeApi = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: { contract: contractFor("1.1.0", [{ type: "FILE", enabled: true, formats: ["PARQUET"] }]) },
    });
    expect(removeApi.statusCode).toBe(422);
    expect(removeApi.json().error.code).toBe("BREAKING_CHANGE_REQUIRES_MAJOR_VERSION");
  });

  it("404s for an unknown product or version", async () => {
    const unknownProduct = await app.inject({
      method: "GET",
      url: `/internal/v1/versions/api-contract?data_product_id=does-not-exist&version=1.0.0`,
    });
    expect(unknownProduct.statusCode).toBe(404);
    expect(unknownProduct.json().error.code).toBe("PRODUCT_NOT_FOUND");

    const unknownVersion = await app.inject({
      method: "GET",
      url: `/internal/v1/versions/api-contract?data_product_id=${productId}&version=9.9.9`,
    });
    expect(unknownVersion.statusCode).toBe(404);
    expect(unknownVersion.json().error.code).toBe("VERSION_NOT_FOUND");
  });
});
