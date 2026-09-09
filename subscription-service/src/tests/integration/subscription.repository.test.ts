import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import { withTransaction } from "../../database/transaction.js";
import {
  findSubscriptionByIdForTenant,
  insertSubscription,
  updateSubscriptionStatus,
} from "../../infrastructure/persistence/subscription.repository.js";
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

function baseInput(overrides: Partial<Parameters<typeof insertSubscription>[1]> = {}) {
  return {
    subscriptionId: randomUUID(),
    organizationId: randomUUID(),
    tenantId: randomUUID(),
    dataProductId: "event-performance",
    status: "ACTIVE" as const,
    versionPolicyType: "COMPATIBLE_MAJOR" as const,
    versionPolicyValue: "1",
    activatedAt: new Date(),
    actorId: "usr-1",
    ...overrides,
  };
}

describe("subscription repository (Postgres)", () => {
  it("enforces one live subscription per tenant/product via the partial unique index", async () => {
    const shared = baseInput();
    await insertSubscription(pool, shared);

    await expect(
      insertSubscription(pool, { ...shared, subscriptionId: randomUUID(), status: "PENDING" }),
    ).rejects.toThrow(AppError);
  });

  it("allows a new subscription for the same tenant/product once the prior one is CANCELLED", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();
    const first = await insertSubscription(pool, baseInput({ organizationId, tenantId }));

    await updateSubscriptionStatus(pool, {
      subscriptionId: first.subscriptionId,
      expectedVersion: first.version,
      status: "CANCELLED",
      timestampColumn: "cancelled_at",
      actorId: "usr-1",
    });

    const second = await insertSubscription(
      pool,
      baseInput({ organizationId, tenantId, subscriptionId: randomUUID() }),
    );
    expect(second.subscriptionId).not.toBe(first.subscriptionId);
  });

  it("optimistic concurrency: a stale-version update is rejected", async () => {
    const subscription = await insertSubscription(pool, baseInput());

    await updateSubscriptionStatus(pool, {
      subscriptionId: subscription.subscriptionId,
      expectedVersion: subscription.version,
      status: "PAUSED",
      timestampColumn: "paused_at",
      actorId: "usr-1",
    });

    await expect(
      updateSubscriptionStatus(pool, {
        subscriptionId: subscription.subscriptionId,
        expectedVersion: subscription.version, // stale
        status: "CANCELLED",
        timestampColumn: "cancelled_at",
        actorId: "usr-1",
      }),
    ).rejects.toThrow(AppError);
  });

  it("rolls back the whole transaction if a later step fails", async () => {
    const subscriptionId = randomUUID();
    await expect(
      withTransaction(async (client) => {
        await insertSubscription(client, baseInput({ subscriptionId }));
        throw new Error("simulated failure after insert");
      }),
    ).rejects.toThrow("simulated failure");

    const { rows } = await pool.query("SELECT 1 FROM subscriptions WHERE subscription_id = $1", [subscriptionId]);
    expect(rows).toHaveLength(0);
  });

  it("tenant-scoped lookup does not leak another tenant's subscription", async () => {
    const subscription = await insertSubscription(pool, baseInput());
    const asOtherTenant = await findSubscriptionByIdForTenant(pool, subscription.organizationId, randomUUID(), subscription.subscriptionId);
    expect(asOtherTenant).toBeNull();
  });
});
