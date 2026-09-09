import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { withTransaction } from "../../database/transaction.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import {
  claimReadyExecutions,
  claimSpecificExecution,
  findExecutionByKey,
  insertExecutionIfAbsent,
  markRetryWait,
  markSucceeded,
} from "../../infrastructure/persistence/execution.repository.js";

const BASE_INPUT = {
  subscriptionId: "sub-test-1",
  organizationId: "org-test",
  tenantId: "tenant-test",
  dataProductId: "event-performance",
  reason: "SCHEDULED" as const,
  scheduledFor: new Date("2026-09-09T06:00:00.000Z"),
  requestedVersionPolicyType: "COMPATIBLE_MAJOR",
  requestedVersionPolicyValue: "1",
  maxAttempts: 5,
};

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("insertExecutionIfAbsent", () => {
  it("is idempotent: the same execution_key never creates a second row", async () => {
    const executionKey = "sub-test-1|2026-09-09T06:00:00.000Z|SCHEDULED";
    const first = await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey });
    const second = await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey });
    expect(second.id).toBe(first.id);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM scheduled_execution WHERE execution_key = $1", [executionKey]);
    expect(rows[0].n).toBe(1);
  });

  it("survives concurrent duplicate inserts (restart / overlapping leadership simulation)", async () => {
    const executionKey = "sub-test-1|2026-09-10T06:00:00.000Z|SCHEDULED";
    const results = await Promise.all(
      Array.from({ length: 5 }, () => insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey, scheduledFor: new Date("2026-09-10T06:00:00.000Z") })),
    );
    const uniqueIds = new Set(results.map((r) => r.id));
    expect(uniqueIds.size).toBe(1);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM scheduled_execution WHERE execution_key = $1", [executionKey]);
    expect(rows[0].n).toBe(1);
  });

  it("different reasons for the same occurrence are distinct executions", async () => {
    const scheduledFor = new Date("2026-09-11T06:00:00.000Z");
    const scheduled = await insertExecutionIfAbsent(pool, {
      ...BASE_INPUT,
      executionKey: "sub-test-1|2026-09-11T06:00:00.000Z|SCHEDULED",
      scheduledFor,
      reason: "SCHEDULED",
    });
    const missed = await insertExecutionIfAbsent(pool, {
      ...BASE_INPUT,
      executionKey: "sub-test-1|2026-09-11T06:00:00.000Z|MISSED_RUN_RECOVERY",
      scheduledFor,
      reason: "MISSED_RUN_RECOVERY",
    });
    expect(scheduled.id).not.toBe(missed.id);
  });
});

describe("claimReadyExecutions", () => {
  it("two concurrent claimers never both claim the same PENDING row (FOR UPDATE SKIP LOCKED)", async () => {
    const executionKey = "sub-test-1|2026-09-12T06:00:00.000Z|SCHEDULED";
    await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey, scheduledFor: new Date("2026-09-12T06:00:00.000Z") });

    const now = new Date("2026-09-12T06:00:05.000Z");
    const [batchA, batchB] = await Promise.all([
      withTransaction((client) => claimReadyExecutions(client, now, 10)),
      withTransaction((client) => claimReadyExecutions(client, now, 10)),
    ]);

    const totalClaimed = batchA.length + batchB.length;
    expect(totalClaimed).toBe(1);
  });

  it("claims PENDING rows and due RETRY_WAIT rows, but not RETRY_WAIT rows not yet due", async () => {
    const pendingKey = "sub-test-1|2026-09-13T06:00:00.000Z|SCHEDULED";
    const pending = await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey: pendingKey, scheduledFor: new Date("2026-09-13T06:00:00.000Z") });

    const dueRetryKey = "sub-test-1|2026-09-14T06:00:00.000Z|SCHEDULED";
    const dueRetry = await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey: dueRetryKey, scheduledFor: new Date("2026-09-14T06:00:00.000Z") });
    await withTransaction((client) =>
      markRetryWait(client, dueRetry.id, {
        failureCategory: "TRANSIENT_DEPENDENCY_FAILURE",
        failureCode: null,
        failureMessage: "transient",
        nextRetryAt: new Date("2026-09-14T06:01:00.000Z"),
      }),
    );

    const notYetDueKey = "sub-test-1|2026-09-15T06:00:00.000Z|SCHEDULED";
    const notYetDue = await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey: notYetDueKey, scheduledFor: new Date("2026-09-15T06:00:00.000Z") });
    await withTransaction((client) =>
      markRetryWait(client, notYetDue.id, {
        failureCategory: "TRANSIENT_DEPENDENCY_FAILURE",
        failureCode: null,
        failureMessage: "transient",
        nextRetryAt: new Date("2026-09-20T00:00:00.000Z"),
      }),
    );

    const now = new Date("2026-09-14T06:02:00.000Z");
    const claimed = await withTransaction((client) => claimReadyExecutions(client, now, 10));
    const claimedIds = claimed.map((c) => c.id).sort();
    expect(claimedIds).toEqual([pending.id, dueRetry.id].sort());
  });
});

describe("claimSpecificExecution", () => {
  it("races safely against a concurrent batch claim of the same row", async () => {
    const executionKey = "sub-test-1|2026-09-16T06:00:00.000Z|SCHEDULED";
    const execution = await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey, scheduledFor: new Date("2026-09-16T06:00:00.000Z") });

    const now = new Date("2026-09-16T06:00:05.000Z");
    const [specific, batch] = await Promise.all([
      withTransaction((client) => claimSpecificExecution(client, execution.id, now)),
      withTransaction((client) => claimReadyExecutions(client, now, 10)),
    ]);

    const claimedCount = (specific ? 1 : 0) + batch.length;
    expect(claimedCount).toBe(1);
  });

  it("does not reclaim an execution that already succeeded", async () => {
    const executionKey = "sub-test-1|2026-09-17T06:00:00.000Z|SCHEDULED";
    const execution = await insertExecutionIfAbsent(pool, { ...BASE_INPUT, executionKey, scheduledFor: new Date("2026-09-17T06:00:00.000Z") });
    await withTransaction((client) => claimReadyExecutions(client, new Date(), 10));
    await withTransaction((client) => markSucceeded(client, execution.id, "pub-123"));

    const reclaimed = await withTransaction((client) => claimSpecificExecution(client, execution.id, new Date()));
    expect(reclaimed).toBeNull();

    const stored = await findExecutionByKey(pool, executionKey);
    expect(stored?.status).toBe("SUCCEEDED");
  });
});
