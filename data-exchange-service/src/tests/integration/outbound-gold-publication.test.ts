import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeader, createTestApp, TENANT_A, TENANT_B } from "../setup/test-helpers.js";
import { env } from "../../config/env.js";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

describe("real Gold -> Publication Service outbound handoff", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects creation without a valid internal API key", async () => {
    const res = await app.inject({ method: "POST", url: "/internal/v1/outbound-publications", payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("creates -> uploads -> completes an outbound publication end to end", async () => {
    const content = Buffer.from("event_id,venue_id,event_date\nevt-1,ven-1,2026-09-06\n");
    const checksum = sha256(content);
    const filename = `event-performance-${randomUUID()}.csv`;

    const createRes = await app.inject({
      method: "POST",
      url: "/internal/v1/outbound-publications",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: {
        organizationId: TENANT_A.organization_id,
        tenantId: TENANT_A.active_tenant_id,
        dataProductId: "event-performance",
        productVersion: "1.0",
        filename,
        format: "CSV",
        sizeBytes: content.length,
        recordCount: 1,
        checksumAlgorithm: "SHA-256",
        checksum,
        sourcePublicationId: `pub-${randomUUID()}`,
        expirationHours: 168,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.status).toBe("PREPARING");
    expect(created.upload.method).toBe("PUT");
    expect(created.upload.url).toContain("http");
    expect(created.upload.contentType).toBe("text/csv");

    const putRes = await fetch(created.upload.url, {
      method: "PUT",
      body: content,
      headers: { "Content-Type": created.upload.contentType },
    });
    expect(putRes.ok).toBe(true);

    const completeRes = await app.inject({
      method: "POST",
      url: `/internal/v1/outbound-publications/${created.exchangeId}/complete`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { publicationId: "pub-test-1", goldSnapshotId: "1234567890", goldPipelineRunId: "run-gold-001" },
    });
    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.json().status).toBe("READY");

    // Idempotent: calling complete again just reports current state.
    const completeAgain = await app.inject({
      method: "POST",
      url: `/internal/v1/outbound-publications/${created.exchangeId}/complete`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { publicationId: "pub-test-1" },
    });
    expect(completeAgain.statusCode).toBe(200);
    expect(completeAgain.json().status).toBe("READY");

    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${created.exchangeId}`,
      headers: authHeader(TENANT_A),
    });
    expect(detailRes.json().direction).toBe("OUTBOUND");
    expect(detailRes.json().status).toBe("READY");

    const manifestRes = await app.inject({
      method: "GET",
      url: `/internal/v1/exchanges/${created.exchangeId}/manifest`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
    });
    expect(manifestRes.statusCode).toBe(200);
    const manifest = manifestRes.json().manifest;
    expect(manifest.publication.publicationId).toBe("pub-test-1");
    expect(manifest.publication.goldSnapshotId).toBe("1234567890");
    expect(manifest.file.checksum).toBe(checksum);
    expect(manifest.file.recordCount).toBe(1);

    // TENANT_A can download; the artifact is byte-for-byte what was uploaded.
    const downloadRes = await app.inject({
      method: "POST",
      url: `/v1/downloads/${created.exchangeId}/url`,
      headers: authHeader(TENANT_A),
    });
    expect(downloadRes.statusCode).toBe(200);
    const download = downloadRes.json();
    expect(download.filename).toBe(filename);

    const fileRes = await fetch(download.downloadUrl);
    expect(fileRes.ok).toBe(true);
    const downloaded = Buffer.from(await fileRes.arrayBuffer());
    expect(sha256(downloaded)).toBe(checksum);
    expect(downloaded.equals(content)).toBe(true);
  });

  it("cannot be downloaded by a different tenant", async () => {
    const content = Buffer.from("event_id\nevt-x\n");
    const checksum = sha256(content);
    const filename = `event-performance-${randomUUID()}.csv`;

    const createRes = await app.inject({
      method: "POST",
      url: "/internal/v1/outbound-publications",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: {
        organizationId: TENANT_A.organization_id,
        tenantId: TENANT_A.active_tenant_id,
        dataProductId: "event-performance",
        productVersion: "1.0",
        filename,
        format: "CSV",
        sizeBytes: content.length,
        recordCount: 1,
        checksumAlgorithm: "SHA-256",
        checksum,
        sourcePublicationId: `pub-${randomUUID()}`,
      },
    });
    const created = createRes.json();
    await fetch(created.upload.url, { method: "PUT", body: content, headers: { "Content-Type": created.upload.contentType } });
    await app.inject({
      method: "POST",
      url: `/internal/v1/outbound-publications/${created.exchangeId}/complete`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { publicationId: "pub-cross-tenant" },
    });

    const crossTenantDownload = await app.inject({
      method: "POST",
      url: `/v1/downloads/${created.exchangeId}/url`,
      headers: authHeader(TENANT_B),
    });
    expect(crossTenantDownload.statusCode).toBe(404);

    const crossTenantDetail = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${created.exchangeId}`,
      headers: authHeader(TENANT_B),
    });
    expect(crossTenantDetail.statusCode).toBe(404);
  });

  it("fails the publication and transitions the exchange to FAILED when the uploaded bytes don't match the declared checksum", async () => {
    const declared = Buffer.from("declared-content");
    const actuallyUploaded = Buffer.from("tampered-content");
    const filename = `event-performance-${randomUUID()}.csv`;

    const createRes = await app.inject({
      method: "POST",
      url: "/internal/v1/outbound-publications",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: {
        organizationId: TENANT_A.organization_id,
        tenantId: TENANT_A.active_tenant_id,
        dataProductId: "event-performance",
        productVersion: "1.0",
        filename,
        format: "CSV",
        sizeBytes: declared.length,
        recordCount: 1,
        checksumAlgorithm: "SHA-256",
        checksum: sha256(declared),
        sourcePublicationId: `pub-${randomUUID()}`,
      },
    });
    const created = createRes.json();
    await fetch(created.upload.url, { method: "PUT", body: actuallyUploaded, headers: { "Content-Type": created.upload.contentType } });

    const completeRes = await app.inject({
      method: "POST",
      url: `/internal/v1/outbound-publications/${created.exchangeId}/complete`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { publicationId: "pub-mismatch" },
    });
    expect(completeRes.statusCode).toBe(422);
    expect(completeRes.json().error.code).toBe("CHECKSUM_MISMATCH");

    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${created.exchangeId}`,
      headers: authHeader(TENANT_A),
    });
    expect(detailRes.json().status).toBe("FAILED");
  });

  it("supports explicit failure reporting via /fail", async () => {
    const content = Buffer.from("x");
    const createRes = await app.inject({
      method: "POST",
      url: "/internal/v1/outbound-publications",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: {
        organizationId: TENANT_A.organization_id,
        tenantId: TENANT_A.active_tenant_id,
        dataProductId: "event-performance",
        productVersion: "1.0",
        filename: `event-performance-${randomUUID()}.csv`,
        format: "CSV",
        sizeBytes: content.length,
        recordCount: 0,
        checksumAlgorithm: "SHA-256",
        checksum: sha256(content),
        sourcePublicationId: `pub-${randomUUID()}`,
      },
    });
    const created = createRes.json();

    const failRes = await app.inject({
      method: "POST",
      url: `/internal/v1/outbound-publications/${created.exchangeId}/fail`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { reason: "Exchange Service unavailable during transfer" },
    });
    expect(failRes.statusCode).toBe(200);
    expect(failRes.json().status).toBe("FAILED");

    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${created.exchangeId}`,
      headers: authHeader(TENANT_A),
    });
    expect(detailRes.json().status).toBe("FAILED");
  });
});
