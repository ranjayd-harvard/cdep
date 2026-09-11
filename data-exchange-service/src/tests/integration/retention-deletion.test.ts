import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, TENANT_A } from "../setup/test-helpers.js";
import { env } from "../../config/env.js";
import { pool } from "../../database/pool.js";
import { generateExchangeId, generateFileId } from "../../common/ids/id-generator.js";
import { createExchange, createExchangeFile } from "../../modules/exchanges/exchange.repository.js";
import { objectStorage } from "../../storage/index.js";

// Phase 11 mandatory retention/legal-hold test (spec §42): an expired
// outbound exchange is deleted (object removed, audit evidence retained);
// the same exchange under legal_hold is blocked instead, with the reason
// recorded, and its object is left untouched.
describe("retention and deletion (spec §42)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedExpiredOutboundExchange(): Promise<{ exchangeId: string; bucket: string; key: string }> {
    const exchangeId = generateExchangeId();
    const bucket = env.OUTBOUND_BUCKET;
    const key = `organizations/${TENANT_A.organization_id}/tenants/${TENANT_A.active_tenant_id}/retention-test/${randomUUID()}.csv`;

    await objectStorage.putObject({ bucket, key, body: "event_id,venue_id\nEVT1,VEN1\n", contentType: "text/csv" });

    await createExchange({
      exchangeId,
      organizationId: TENANT_A.organization_id,
      tenantId: TENANT_A.active_tenant_id,
      direction: "OUTBOUND",
      dataProductId: "event-performance",
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 60_000),
    });
    await createExchangeFile({
      exchangeFileId: generateFileId(),
      exchangeId,
      fileRole: "DATA",
      originalFilename: "retention-test.csv",
      bucketName: bucket,
      objectKey: key,
    });

    return { exchangeId, bucket, key };
  }

  it("deletes an expired outbound exchange's artifact and retains audit evidence", async () => {
    const { exchangeId, bucket, key } = await seedExpiredOutboundExchange();

    const res = await app.inject({
      method: "POST",
      url: `/internal/v1/exchanges/${exchangeId}/deletion-requests`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { reason: "retention policy expired", actorType: "SYSTEM", actorId: "retention-test" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("COMPLETED");

    const exchangeRow = await pool.query("SELECT status FROM exchange.exchanges WHERE exchange_id = $1", [exchangeId]);
    expect(exchangeRow.rows[0].status).toBe("DELETED");

    const head = await objectStorage.headObject(bucket, key);
    expect(head.exists).toBe(false);

    const auditRows = await pool.query(
      `SELECT event_type FROM exchange.security_audit_events WHERE resource_id = $1 ORDER BY occurred_at ASC`,
      [exchangeId],
    );
    const eventTypes = auditRows.rows.map((r) => r.event_type);
    expect(eventTypes).toContain("DELETION_REQUESTED");
    expect(eventTypes).toContain("RETENTION_EXECUTED");
    expect(eventTypes).toContain("DELETION_COMPLETED");
  });

  it("blocks deletion when legal_hold is set, records the reason, and leaves the artifact intact", async () => {
    const { exchangeId, bucket, key } = await seedExpiredOutboundExchange();

    const holdRes = await app.inject({
      method: "PUT",
      url: `/internal/v1/exchanges/${exchangeId}/legal-hold`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { legalHold: true, actorType: "USER", actorId: "legal-team" },
    });
    expect(holdRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: `/internal/v1/exchanges/${exchangeId}/deletion-requests`,
      headers: { "x-internal-api-key": env.INTERNAL_API_KEY },
      payload: { reason: "retention policy expired", actorType: "SYSTEM", actorId: "retention-test" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("BLOCKED");
    expect(body.error_message).toBe("LEGAL_HOLD");

    const exchangeRow = await pool.query("SELECT status, legal_hold FROM exchange.exchanges WHERE exchange_id = $1", [
      exchangeId,
    ]);
    expect(exchangeRow.rows[0].status).toBe("EXPIRED");
    expect(exchangeRow.rows[0].legal_hold).toBe(true);

    // The artifact must still exist.
    const head = await objectStorage.headObject(bucket, key);
    expect(head.exists).toBe(true);

    const auditRows = await pool.query(
      `SELECT event_type, reason_code, decision FROM exchange.security_audit_events WHERE resource_id = $1 ORDER BY occurred_at ASC`,
      [exchangeId],
    );
    const blocked = auditRows.rows.find((r) => r.event_type === "DELETION_BLOCKED");
    expect(blocked).toBeDefined();
    expect(blocked.reason_code).toBe("LEGAL_HOLD");
    expect(blocked.decision).toBe("DENY");
  });
});
