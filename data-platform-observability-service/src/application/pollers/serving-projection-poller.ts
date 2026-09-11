import type { ServingProjectionClient } from "../../ports/serving-projection-client.port.js";
import { PollLoop } from "../../infrastructure/scheduling/poll-loop.js";
import { env } from "../../config/env.js";
import { pool } from "../../database/pool.js";
import { recordServiceHealth } from "../../infrastructure/persistence/service-health.repository.js";
import { logger } from "../../common/logger/logger.js";

// serving-projection-service's projection_runs carries no tenant columns
// (confirmed) — it cannot be part of any per-execution correlation chain,
// so this poller feeds service_health only, never the event-ingestion
// pipeline (plan section 9 reduction #4).
export function createServingProjectionPoller(client: ServingProjectionClient): PollLoop {
  return new PollLoop("serving-projection", env.POLL_INTERVAL_SECONDS_SERVING_PROJECTION, async () => {
    try {
      const runs = await client.listRecent(5);
      const latest = runs[0];
      const healthy = latest ? latest.status.toUpperCase() !== "FAILED" : true;
      await recordServiceHealth(pool, {
        serviceName: "serving-projection-service",
        status: healthy ? "OK" : "DEGRADED",
        latencyMs: null,
        errorMessage: healthy ? null : `Latest projection run ${latest?.projectionRunId} status=${latest?.status}`,
      });
    } catch (err) {
      logger.warn({ err }, "serving-projection health poll failed");
      await recordServiceHealth(pool, {
        serviceName: "serving-projection-service",
        status: "UNAVAILABLE",
        latencyMs: null,
        errorMessage: (err as Error).message,
      });
    }
  });
}
