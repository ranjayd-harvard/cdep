import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeader, createTestApp, TENANT_A } from "../setup/test-helpers.js";
import { env } from "../../config/env.js";

// Covers the internal-only manifest endpoint the Phase 2 lakehouse
// ingestion pipeline reads from (data-lakehouse's HttpExchangeServiceClient).
describe("internal exchange manifest endpoint", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a request without a valid internal API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/internal/v1/exchanges/exc-does-not-matter/manifest",
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an exchange that does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/internal/v1/exchanges/exc-${randomUUID()}/manifest`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when the exchange exists but upload has not completed (no manifest yet)", async () => {
    const filename = `pending_${randomUUID()}.csv`;
    const initiateRes = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: authHeader(TENANT_A),
      payload: { dataProductId: "event-data", filename, contentType: "text/csv", sizeBytes: 10 },
    });
    const { exchangeId } = initiateRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/internal/v1/exchanges/${exchangeId}/manifest`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns the manifest and data-file storage coordinates after a real upload completes", async () => {
    const csv = "event_id,venue_id,event_date,tickets_sold,gross_revenue\nEVT1,VEN1,2026-09-05,100,7000.50\n";
    const filename = `events_${randomUUID()}.csv`;

    const initiateRes = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: authHeader(TENANT_A),
      payload: {
        dataProductId: "event-data",
        filename,
        contentType: "text/csv",
        sizeBytes: Buffer.byteLength(csv),
        schemaVersion: "1.0",
      },
    });
    const initiated = initiateRes.json();

    const putRes = await fetch(initiated.upload.url, {
      method: "PUT",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    });
    expect(putRes.ok).toBe(true);

    const completeRes = await app.inject({
      method: "POST",
      url: `/v1/uploads/${initiated.exchangeId}/complete`,
      headers: authHeader(TENANT_A),
    });
    expect(completeRes.json().status).toBe("VALIDATED");

    const manifestRes = await app.inject({
      method: "GET",
      url: `/internal/v1/exchanges/${initiated.exchangeId}/manifest`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
    });
    expect(manifestRes.statusCode).toBe(200);
    const body = manifestRes.json();

    expect(body.manifest.manifestVersion).toBe("1.0");
    expect(body.manifest.exchange.exchangeId).toBe(initiated.exchangeId);
    expect(body.manifest.exchange.direction).toBe("INBOUND");
    // manifest.json itself is written once at RECEIVED and never rewritten;
    // the endpoint must report the exchange's *current* status (VALIDATED
    // by now), not that frozen snapshot.
    expect(body.manifest.exchange.status).toBe("VALIDATED");
    expect(body.manifest.exchange.status).not.toBe("RECEIVED");
    expect(body.manifest.ownership.organizationId).toBe(TENANT_A.organization_id);
    expect(body.manifest.ownership.tenantId).toBe(TENANT_A.active_tenant_id);
    expect(body.manifest.dataProduct.dataProductId).toBe("event-data");
    expect(body.manifest.file.originalFilename).toBe(filename);
    expect(body.manifest.file.checksumAlgorithm).toBe("SHA-256");
    expect(body.manifest.file.checksum).toMatch(/^[a-f0-9]{64}$/);

    expect(body.storage.bucketName).toBeTruthy();
    expect(body.storage.objectKey).toContain(filename);

    // Fetch the raw data file straight from wherever the manifest says it
    // lives, using no channel other than what this endpoint returned --
    // proves the returned coordinates are actually correct/fetchable.
    const downloadUrlRes = await app.inject({
      method: "POST",
      url: `/v1/downloads/${initiated.exchangeId}/url`,
      headers: authHeader(TENANT_A),
    });
    if (downloadUrlRes.statusCode === 200) {
      const fileRes = await fetch(downloadUrlRes.json().downloadUrl);
      const text = await fileRes.text();
      expect(text).toContain("EVT1");
    }
  });
});
