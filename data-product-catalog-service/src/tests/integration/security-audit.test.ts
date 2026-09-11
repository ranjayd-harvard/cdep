import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "../setup/test-helpers.js";
import { pool } from "../../database/pool.js";

// Phase 11 (spec §28/§29): a rejected RESTRICTED-field contract must leave
// a CONTRACT_POLICY_VIOLATION row in the append-only security audit table,
// distinct from registration_events (which only records successful
// registrations).
describe("security audit events", () => {
  let app: FastifyInstance;
  const suffix = randomUUID().slice(0, 8);
  const domainId = `audit-domain-${suffix}`;
  const ownerId = `audit-owner-${suffix}`;
  const productId = `audit-product-${suffix}`;

  beforeAll(async () => {
    app = await createTestApp();
    await app.inject({ method: "POST", url: "/internal/v1/domains", payload: { domainId, name: domainId, displayName: "Audit Domain" } });
    await app.inject({ method: "POST", url: "/internal/v1/owners", payload: { ownerId, ownerType: "TEAM", name: "Audit Owner" } });
  });

  afterAll(async () => {
    await app.close();
  });

  it("records CONTRACT_POLICY_VIOLATION when a RESTRICTED field is missing governance metadata", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/v1/contracts/register",
      payload: {
        contract: {
          apiVersion: "data-platform/v1",
          kind: "DataProduct",
          metadata: { id: productId, name: `Audit Product ${suffix}`, version: "1.0.0" },
          spec: {
            domain: { id: domainId },
            owner: { id: ownerId },
            grain: { description: "One row per event", keys: ["event_id"] },
            schema: [
              { name: "event_id", type: "string", required: true, grainKey: true },
              // Missing piiType/maskingPolicy — must be rejected (spec §20).
              { name: "customer_email", type: "string", classification: "RESTRICTED", pii: true },
            ],
            delivery: { methods: [{ type: "FILE", enabled: true, formats: ["PARQUET"] }] },
          },
        },
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("CONTRACT_INVALID");

    const { rows } = await pool.query(
      `SELECT event_type, decision, reason_code, resource_id FROM catalog.security_audit_events
       WHERE resource_id = $1 AND event_type = 'CONTRACT_POLICY_VIOLATION' ORDER BY occurred_at DESC LIMIT 1`,
      [productId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe("DENY");
    expect(rows[0].reason_code).toBe("CONTRACT_INVALID");
  });
});
