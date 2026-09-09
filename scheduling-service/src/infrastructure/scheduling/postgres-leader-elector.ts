import pg from "pg";
import { logger } from "../../common/logger/logger.js";
import { env } from "../../config/env.js";
import type { LeaderElector } from "../../ports/leader-elector.port.js";

// AGENTS.md section 14: PostgreSQL session-level advisory lock. Requires
// its own dedicated connection (advisory locks are tied to the session
// that took them, not to any particular query) — never borrowed from the
// shared pool, where a connection could be handed to unrelated queries
// between calls.
//
// This is an optimization/control mechanism, not the correctness
// guarantee (section 15): even if two processes both briefly believe
// they're leader — a startup race, a network blip that drops this
// session — execution_key's UNIQUE constraint is what actually prevents a
// duplicate logical execution.
const LOCK_KEY = "scheduling-service:leader";

export class PostgresAdvisoryLockLeaderElector implements LeaderElector {
  private client: pg.Client | null = null;
  private leader = false;

  isLeader(): boolean {
    return this.leader;
  }

  async tryAcquire(): Promise<boolean> {
    try {
      if (!this.client) {
        this.client = new pg.Client({ connectionString: env.DATABASE_URL });
        await this.client.connect();
      }
      const { rows } = await this.client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired",
        [LOCK_KEY],
      );
      const acquired = rows[0]?.acquired === true;
      if (acquired && !this.leader) logger.info("scheduler.leadership.acquired");
      if (!acquired && this.leader) logger.warn("scheduler.leadership.lost");
      this.leader = acquired;
      return acquired;
    } catch (err) {
      if (this.leader) logger.warn({ err }, "scheduler.leadership.lost");
      logger.error({ err }, "Leader election check failed; treating this process as not-leader");
      this.leader = false;
      // Drop the broken connection so the next attempt reconnects cleanly
      // rather than repeatedly querying a dead session.
      await this.client?.end().catch(() => {});
      this.client = null;
      return false;
    }
  }

  async release(): Promise<void> {
    if (this.client) {
      try {
        // Unlock-all rather than a single unlock: tryAcquire() is called
        // once per scan tick and Postgres advisory locks are re-entrant
        // per session, so repeated acquisition without an intervening
        // release can leave the hold count above 1.
        await this.client.query("SELECT pg_advisory_unlock_all()");
      } catch {
        // Connection may already be broken — nothing to clean up.
      }
      await this.client.end().catch(() => {});
      this.client = null;
    }
    this.leader = false;
  }
}
