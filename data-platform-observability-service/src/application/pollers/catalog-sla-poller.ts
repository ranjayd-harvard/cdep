import type pg from "pg";
import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { Clock } from "../../ports/clock.port.js";
import { PollLoop } from "../../infrastructure/scheduling/poll-loop.js";
import { env } from "../../config/env.js";
import { pool } from "../../database/pool.js";
import { syncSlaDefinitionsFromCatalog } from "../services/catalog-sla-sync.service.js";
import { logger } from "../../common/logger/logger.js";

async function listRecentProductVersionScopes(client: pg.Pool | pg.PoolClient): Promise<Array<{ dataProductId: string; productVersion: string }>> {
  const { rows } = await client.query<{ data_product_id: string; product_version: string }>(
    `SELECT DISTINCT data_product_id, product_version FROM operational_executions
     WHERE product_version <> 'unresolved' AND started_at > now() - interval '7 days'`,
  );
  return rows.map((r) => ({ dataProductId: r.data_product_id, productVersion: r.product_version }));
}

// Periodically re-syncs cached SLA definitions (spec section 12) for every
// (product, version) with recent activity — catches a declared-SLA change
// in catalog even for a product/version this service isn't actively
// ingesting new events for at that exact moment.
export function createCatalogSlaPoller(catalogClient: CatalogClient, clock: Clock): PollLoop {
  return new PollLoop("catalog-sla", env.POLL_INTERVAL_SECONDS_CATALOG, async () => {
    const scopes = await listRecentProductVersionScopes(pool);
    const now = clock.now();
    for (const scope of scopes) {
      try {
        await syncSlaDefinitionsFromCatalog(pool, catalogClient, scope.dataProductId, scope.productVersion, now);
      } catch (err) {
        logger.warn({ err, scope }, "catalog-sla-poller: sync failed for scope");
      }
    }
  });
}
