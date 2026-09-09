import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import {
  findEntitlementByTenantProduct,
  setEntitlementEffect,
  upsertEntitlement,
} from "../../infrastructure/persistence/entitlement.repository.js";
import { AppError } from "../../common/errors/app-error.js";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("entitlement repository (Postgres)", () => {
  it("upserts one current decision per tenant/product (unique index)", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();

    const first = await upsertEntitlement(pool, {
      entitlementId: "ent-1",
      organizationId,
      tenantId,
      dataProductId: "event-performance",
      effect: "ALLOW",
      validFrom: null,
      validUntil: null,
      reason: "initial grant",
      actorId: "admin-1",
    });

    const second = await upsertEntitlement(pool, {
      entitlementId: "ent-2", // ignored on conflict — the original row's id is kept
      organizationId,
      tenantId,
      dataProductId: "event-performance",
      effect: "DENY",
      validFrom: null,
      validUntil: null,
      reason: "revoked",
      actorId: "admin-1",
    });

    expect(second.entitlementId).toBe(first.entitlementId);
    expect(second.effect).toBe("DENY");
    expect(second.version).toBe(2);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM entitlements WHERE organization_id = $1 AND tenant_id = $2", [
      organizationId,
      tenantId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("marks revoked_at/revoked_by only on an ALLOW -> DENY transition", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();

    const denyFromScratch = await upsertEntitlement(pool, {
      entitlementId: "ent-3",
      organizationId,
      tenantId,
      dataProductId: "prod-a",
      effect: "DENY",
      validFrom: null,
      validUntil: null,
      reason: null,
      actorId: "admin-1",
    });
    expect(denyFromScratch.revokedAt).toBeNull();

    await upsertEntitlement(pool, {
      entitlementId: "ent-4",
      organizationId,
      tenantId,
      dataProductId: "prod-b",
      effect: "ALLOW",
      validFrom: null,
      validUntil: null,
      reason: null,
      actorId: "admin-1",
    });
    const revoked = await upsertEntitlement(pool, {
      entitlementId: "ent-4",
      organizationId,
      tenantId,
      dataProductId: "prod-b",
      effect: "DENY",
      validFrom: null,
      validUntil: null,
      reason: "contract ended",
      actorId: "admin-2",
    });
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.revokedBy).toBe("admin-2");
  });

  it("optimistic concurrency rejects a stale version with CONCURRENT_MODIFICATION", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();
    const entitlement = await upsertEntitlement(pool, {
      entitlementId: "ent-5",
      organizationId,
      tenantId,
      dataProductId: "prod-c",
      effect: "ALLOW",
      validFrom: null,
      validUntil: null,
      reason: null,
      actorId: "admin-1",
    });

    await setEntitlementEffect(pool, {
      entitlementId: entitlement.entitlementId,
      expectedVersion: entitlement.version,
      effect: "DENY",
      actorId: "admin-1",
    });

    await expect(
      setEntitlementEffect(pool, {
        entitlementId: entitlement.entitlementId,
        expectedVersion: entitlement.version, // stale — already bumped by the update above
        effect: "ALLOW",
        actorId: "admin-2",
      }),
    ).rejects.toThrow(AppError);
  });

  it("tenant-scoped lookup does not leak another tenant's row", async () => {
    const organizationId = randomUUID();
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    await upsertEntitlement(pool, {
      entitlementId: "ent-6",
      organizationId,
      tenantId: tenantA,
      dataProductId: "prod-d",
      effect: "ALLOW",
      validFrom: null,
      validUntil: null,
      reason: null,
      actorId: "admin-1",
    });

    const crossTenant = await findEntitlementByTenantProduct(pool, organizationId, tenantB, "prod-d");
    expect(crossTenant).toBeNull();
  });
});
