import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeader, createTestApp, TENANT_A } from "../setup/test-helpers.js";
import { env } from "../../config/env.js";
import { pool } from "../../database/pool.js";

describe("outbound publication and download", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects publication without a valid internal API key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/publications",
      payload: {
        organizationId: TENANT_A.organization_id,
        tenantId: TENANT_A.active_tenant_id,
        dataProductId: "event-performance",
        filename: "should-fail.csv",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("publishes a fixture outbound exchange and allows the owning tenant to download it", async () => {
    const filename = `event-performance-${randomUUID()}.csv`;

    const publishRes = await app.inject({
      method: "POST",
      url: "/internal/v1/publications",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: {
        organizationId: TENANT_A.organization_id,
        tenantId: TENANT_A.active_tenant_id,
        dataProductId: "event-performance",
        schemaVersion: "1.0",
        sourceObject: "gold/event_performance/fixture.csv",
        filename,
      },
    });
    expect(publishRes.statusCode).toBe(201);
    const published = publishRes.json();
    expect(published.status).toBe("READY");

    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/exchanges/${published.exchangeId}`,
      headers: authHeader(TENANT_A),
    });
    expect(detailRes.json().direction).toBe("OUTBOUND");
    expect(detailRes.json().status).toBe("READY");

    const downloadRes = await app.inject({
      method: "POST",
      url: `/v1/downloads/${published.exchangeId}/url`,
      headers: authHeader(TENANT_A),
    });
    expect(downloadRes.statusCode).toBe(200);
    const download = downloadRes.json();
    expect(download.filename).toBe(filename);
    expect(download.downloadUrl).toContain("http");

    const fileRes = await fetch(download.downloadUrl);
    expect(fileRes.ok).toBe(true);
    const text = await fileRes.text();
    expect(text).toContain("id,metric,value");

    const { rows } = await pool.query(
      `SELECT checksum, checksum_algorithm, size_bytes FROM exchange.exchange_files
       WHERE exchange_id = $1 AND file_role = 'DATA'`,
      [published.exchangeId],
    );
    expect(rows[0].checksum_algorithm).toBe("SHA-256");
    expect(rows[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(rows[0].size_bytes)).toBeGreaterThan(0);
  });

  it("refuses to issue a download URL for an expired outbound exchange", async () => {
    const filename = `expiring-${randomUUID()}.csv`;
    const publishRes = await app.inject({
      method: "POST",
      url: "/internal/v1/publications",
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: {
        organizationId: TENANT_A.organization_id,
        tenantId: TENANT_A.active_tenant_id,
        dataProductId: "event-performance",
        filename,
      },
    });
    const { exchangeId } = publishRes.json();

    await pool.query(`UPDATE exchange.exchanges SET expires_at = now() - interval '1 hour' WHERE exchange_id = $1`, [
      exchangeId,
    ]);

    const downloadRes = await app.inject({
      method: "POST",
      url: `/v1/downloads/${exchangeId}/url`,
      headers: authHeader(TENANT_A),
    });
    expect(downloadRes.statusCode).toBe(410);
    expect(downloadRes.json().error.code).toBe("EXCHANGE_EXPIRED");
  });
});
