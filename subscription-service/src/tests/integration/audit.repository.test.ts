import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import { listAuditEventsForEntity, recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("audit repository (Postgres)", () => {
  it("persists append-only events readable by entity", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();
    const entitlementId = "ent-1";

    await recordAuditEvent(pool, {
      organizationId,
      tenantId,
      entityType: "ENTITLEMENT",
      entityId: entitlementId,
      action: "ENTITLEMENT_GRANTED",
      previousState: null,
      newState: { effect: "ALLOW" },
      actorType: "USER",
      actorId: "admin-1",
      correlationId: "corr-1",
      idempotencyKey: null,
    });

    await recordAuditEvent(pool, {
      organizationId,
      tenantId,
      entityType: "ENTITLEMENT",
      entityId: entitlementId,
      action: "ENTITLEMENT_DENIED",
      previousState: { effect: "ALLOW" },
      newState: { effect: "DENY" },
      actorType: "USER",
      actorId: "admin-2",
      correlationId: "corr-2",
      idempotencyKey: null,
    });

    const events = await listAuditEventsForEntity(pool, organizationId, tenantId, "ENTITLEMENT", entitlementId);
    expect(events).toHaveLength(2);
    expect(events[0]?.action).toBe("ENTITLEMENT_DENIED"); // most recent first
    expect(events[1]?.action).toBe("ENTITLEMENT_GRANTED");
  });

  it("scopes audit reads by organization/tenant", async () => {
    const entitlementId = "ent-shared-id";
    await recordAuditEvent(pool, {
      organizationId: randomUUID(),
      tenantId: randomUUID(),
      entityType: "ENTITLEMENT",
      entityId: entitlementId,
      action: "ENTITLEMENT_GRANTED",
      previousState: null,
      newState: {},
      actorType: "USER",
      actorId: "admin-1",
      correlationId: null,
      idempotencyKey: null,
    });

    const events = await listAuditEventsForEntity(pool, randomUUID(), randomUUID(), "ENTITLEMENT", entitlementId);
    expect(events).toHaveLength(0);
  });
});
