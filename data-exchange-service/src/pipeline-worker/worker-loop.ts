import { env } from "../config/env.js";
import { logger } from "../common/logger/logger.js";
import { processNextPipelineJob } from "./pipeline-worker.service.js";

let timer: NodeJS.Timeout | undefined;
let inFlight = false;

// Started from server.ts only when both LAKEHOUSE_SERVICE_URL and
// PUBLICATION_SERVICE_URL are configured -- same opt-in, non-breaking
// pattern as every other optional integration in this codebase. When
// either is unset, enqueued jobs simply accumulate as PENDING instead of
// this crashing anything.
export function startPipelineWorker(): void {
  if (!env.LAKEHOUSE_SERVICE_URL || !env.PUBLICATION_SERVICE_URL) {
    logger.info("Pipeline worker not started (LAKEHOUSE_SERVICE_URL / PUBLICATION_SERVICE_URL not configured)");
    return;
  }

  timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    processNextPipelineJob()
      .catch((err: unknown) => logger.error({ err }, "Pipeline worker tick failed"))
      .finally(() => {
        inFlight = false;
      });
  }, env.PIPELINE_WORKER_POLL_INTERVAL_MS);

  logger.info({ intervalMs: env.PIPELINE_WORKER_POLL_INTERVAL_MS }, "Pipeline worker started");
}

export function stopPipelineWorker(): void {
  if (timer) clearInterval(timer);
}
