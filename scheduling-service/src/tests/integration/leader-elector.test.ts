import { afterAll, afterEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { PostgresAdvisoryLockLeaderElector } from "../../infrastructure/scheduling/postgres-leader-elector.js";

const electors: PostgresAdvisoryLockLeaderElector[] = [];

function newElector(): PostgresAdvisoryLockLeaderElector {
  const e = new PostgresAdvisoryLockLeaderElector();
  electors.push(e);
  return e;
}

afterEach(async () => {
  await Promise.all(electors.splice(0).map((e) => e.release()));
});

afterAll(async () => {
  await pool.end();
});

describe("PostgresAdvisoryLockLeaderElector", () => {
  it("only one of two instances acquires leadership at a time", async () => {
    const a = newElector();
    const b = newElector();

    expect(await a.tryAcquire()).toBe(true);
    expect(await b.tryAcquire()).toBe(false);
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
  });

  it("survives a leadership transition: releasing lets another instance acquire", async () => {
    const a = newElector();
    const b = newElector();

    expect(await a.tryAcquire()).toBe(true);
    await a.release();

    expect(await b.tryAcquire()).toBe(true);
    expect(b.isLeader()).toBe(true);
  });

  it("repeated tryAcquire calls by the same leader remain stable", async () => {
    const a = newElector();
    expect(await a.tryAcquire()).toBe(true);
    expect(await a.tryAcquire()).toBe(true);
    expect(await a.tryAcquire()).toBe(true);
    expect(a.isLeader()).toBe(true);
  });
});
