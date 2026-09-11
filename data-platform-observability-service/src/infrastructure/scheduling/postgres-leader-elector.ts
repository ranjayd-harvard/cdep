import pg from "pg";
import { logger } from "../../common/logger/logger.js";
import { env } from "../../config/env.js";
import type { LeaderElector } from "../../ports/leader-elector.port.js";

// PostgreSQL session-level advisory lock, mirroring scheduling-service's
// PostgresAdvisoryLockLeaderElector. Only the write-side reconciliation
// loop needs this — read-only polling is harmless run concurrently across
// instances, but concurrent reconciliation repair writes are not.
const LOCK_KEY = "data-platform-observability-service:reconciliation-leader";

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
      if (acquired && !this.leader) logger.info("reconciliation.leadership.acquired");
      if (!acquired && this.leader) logger.warn("reconciliation.leadership.lost");
      this.leader = acquired;
      return acquired;
    } catch (err) {
      if (this.leader) logger.warn({ err }, "reconciliation.leadership.lost");
      logger.error({ err }, "Leader election check failed; treating this process as not-leader");
      this.leader = false;
      await this.client?.end().catch(() => {});
      this.client = null;
      return false;
    }
  }

  async release(): Promise<void> {
    if (this.client) {
      try {
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
