import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeader, createTestApp, TENANT_A } from "../setup/test-helpers.js";
import { pool } from "../../database/pool.js";

describe("upload lifecycle (inbound exchange)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, uploads, completes, and validates an inbound exchange end to end", async () => {
    const csv = "event_id,event_type,occurred_at\nevt-1,click,2026-09-04T00:00:00Z\nevt-2,view,2026-09-04T00:01:00Z\n";
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
        schemaVersion: "2.1",
      },
    });
    expect(initiateRes.statusCode).toBe(200);
    const initiated = initiateRes.json();
    expect(initiated.status).toBe("PENDING_UPLOAD");
    expect(initiated.upload.method).toBe("PUT");
    expect(initiated.upload.url).toContain("http");

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
    expect(completeRes.statusCode).toBe(200);
    const completed = completeRes.json();
    expect(completed.exchangeId).toBe(initiated.exchangeId);
    expect(completed.status).toBe("VALIDATED");

    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${initiated.exchangeId}`,
      headers: authHeader(TENANT_A),
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.direction).toBe("INBOUND");
    expect(detail.status).toBe("VALIDATED");
    expect(detail.file.filename).toBe(filename);
    expect(detail.file.sizeBytes).toBe(Buffer.byteLength(csv));
    expect(detail.recordCount).toBe(2);
    expect(detail.errorCount).toBe(0);
    // Internal storage coordinates must never leak to the customer-facing response.
    expect(detail).not.toHaveProperty("bucket");
    expect(detail).not.toHaveProperty("objectKey");
    expect(JSON.stringify(detail)).not.toContain("exchange-inbound");

    const eventsRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${initiated.exchangeId}/events`,
      headers: authHeader(TENANT_A),
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventTypes = eventsRes.json().items.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toEqual([
      "EXCHANGE_CREATED",
      "UPLOAD_URL_ISSUED",
      "FILE_RECEIVED",
      "MANIFEST_CREATED",
      "VALIDATION_STARTED",
      "VALIDATION_COMPLETED",
      "EXCHANGE_READY_FOR_INGESTION",
    ]);

    const validationRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${initiated.exchangeId}/validation`,
      headers: authHeader(TENANT_A),
    });
    expect(validationRes.statusCode).toBe(200);
    const validation = validationRes.json();
    expect(validation.status).toBe("PASSED");
    expect(validation.totalRecords).toBe(2);
    expect(validation.invalidRecords).toBe(0);

    // Checksum metadata must survive the initiate (INSERT) -> complete
    // (UPDATE on conflict) round trip, not just the initial insert.
    const { rows: fileRows } = await pool.query(
      `SELECT checksum, checksum_algorithm, size_bytes FROM exchange.exchange_files
       WHERE exchange_id = $1 AND file_role = 'DATA'`,
      [initiated.exchangeId],
    );
    expect(fileRows[0].checksum_algorithm).toBe("SHA-256");
    expect(fileRows[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(fileRows[0].size_bytes)).toBe(Buffer.byteLength(csv));

    // Idempotent completion: calling /complete again must not duplicate events.
    const completeAgainRes = await app.inject({
      method: "POST",
      url: `/v1/uploads/${initiated.exchangeId}/complete`,
      headers: authHeader(TENANT_A),
    });
    expect(completeAgainRes.statusCode).toBe(200);
    expect(completeAgainRes.json().status).toBe("VALIDATED");

    const eventsAfterRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${initiated.exchangeId}/events`,
      headers: authHeader(TENANT_A),
    });
    expect(eventsAfterRes.json().items).toHaveLength(eventTypes.length);
  });

  it("is idempotent on initiate when the same Idempotency-Key is reused", async () => {
    const csv = "a,b\n1,2\n";
    const filename = `idem_${randomUUID()}.csv`;
    const idempotencyKey = randomUUID();

    const first = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: { ...authHeader(TENANT_A), "idempotency-key": idempotencyKey },
      payload: { dataProductId: "event-data", filename, contentType: "text/csv", sizeBytes: Buffer.byteLength(csv) },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: { ...authHeader(TENANT_A), "idempotency-key": idempotencyKey },
      payload: { dataProductId: "event-data", filename, contentType: "text/csv", sizeBytes: Buffer.byteLength(csv) },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().exchangeId).toBe(first.json().exchangeId);
  });

  it("rejects an oversize declared upload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: authHeader(TENANT_A),
      payload: {
        dataProductId: "event-data",
        filename: "huge.csv",
        contentType: "text/csv",
        sizeBytes: 999_999_999_999,
      },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects a zero-byte upload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: authHeader(TENANT_A),
      payload: { dataProductId: "event-data", filename: "empty.csv", contentType: "text/csv", sizeBytes: 0 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_FILE");
  });

  it("rejects an unsupported file type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: authHeader(TENANT_A),
      payload: {
        dataProductId: "event-data",
        filename: "script.exe",
        contentType: "application/x-msdownload",
        sizeBytes: 1024,
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_FILE");
  });

  it("rejects uploads for a data product the tenant is not entitled to", async () => {
    // event-performance is an OUTBOUND-only product; no can_upload entitlement exists.
    const res = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: authHeader(TENANT_A),
      payload: {
        dataProductId: "event-performance",
        filename: "data.csv",
        contentType: "text/csv",
        sizeBytes: 100,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("ENTITLEMENT_DENIED");
  });
});
