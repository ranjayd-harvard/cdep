import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import { withIdempotency } from "../../infrastructure/idempotency/with-idempotency.js";
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

describe("withIdempotency (Postgres-backed)", () => {
  it("returns the original result for a replayed key + identical payload, without re-running the side effect", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();
    const idempotencyKey = "req-1";
    let executions = 0;

    const run = () =>
      withIdempotency(
        { idempotencyKey, organizationId, tenantId, operation: "CREATE_SUBSCRIPTION", requestBody: { dataProductId: "prod-a" } },
        async () => {
          executions += 1;
          return { status: 201, body: { subscriptionId: "sub-1" }, resourceId: "sub-1" };
        },
      );

    const first = await run();
    const second = await run();

    expect(executions).toBe(1);
    expect(second).toEqual(first);
  });

  it("rejects the same key with a different payload as IDEMPOTENCY_KEY_REUSED", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();
    const idempotencyKey = "req-2";

    await withIdempotency(
      { idempotencyKey, organizationId, tenantId, operation: "CREATE_SUBSCRIPTION", requestBody: { dataProductId: "prod-a" } },
      async () => ({ status: 201, body: { subscriptionId: "sub-1" }, resourceId: "sub-1" }),
    );

    await expect(
      withIdempotency(
        { idempotencyKey, organizationId, tenantId, operation: "CREATE_SUBSCRIPTION", requestBody: { dataProductId: "prod-b" } },
        async () => ({ status: 201, body: { subscriptionId: "sub-2" }, resourceId: "sub-2" }),
      ),
    ).rejects.toThrow(AppError);
  });

  it("scopes replay by operation and tenant — the same key means nothing across either boundary", async () => {
    const organizationId = randomUUID();
    const tenantId = randomUUID();
    const otherTenant = randomUUID();
    const idempotencyKey = "shared-key";

    await withIdempotency(
      { idempotencyKey, organizationId, tenantId, operation: "CREATE_SUBSCRIPTION", requestBody: { a: 1 } },
      async () => ({ status: 201, body: { subscriptionId: "sub-1" }, resourceId: "sub-1" }),
    );

    let ranForOtherTenant = false;
    await withIdempotency(
      { idempotencyKey, organizationId, tenantId: otherTenant, operation: "CREATE_SUBSCRIPTION", requestBody: { a: 1 } },
      async () => {
        ranForOtherTenant = true;
        return { status: 201, body: { subscriptionId: "sub-2" }, resourceId: "sub-2" };
      },
    );
    expect(ranForOtherTenant).toBe(true);

    let ranForOtherOperation = false;
    await withIdempotency(
      { idempotencyKey, organizationId, tenantId, operation: "CANCEL_SUBSCRIPTION", requestBody: { a: 1 } },
      async () => {
        ranForOtherOperation = true;
        return { status: 200, body: {}, resourceId: null };
      },
    );
    expect(ranForOtherOperation).toBe(true);
  });

  it("executes normally when no Idempotency-Key is supplied", async () => {
    let executions = 0;
    const run = () =>
      withIdempotency(
        { idempotencyKey: undefined, organizationId: randomUUID(), tenantId: randomUUID(), operation: "CREATE_SUBSCRIPTION", requestBody: {} },
        async () => {
          executions += 1;
          return { status: 201, body: {}, resourceId: null };
        },
      );

    await run();
    await run();
    expect(executions).toBe(2);
  });
});
