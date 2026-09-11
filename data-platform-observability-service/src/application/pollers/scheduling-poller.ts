import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { SchedulingClient } from "../../ports/scheduling-client.port.js";
import type { Clock } from "../../ports/clock.port.js";
import { PollLoop } from "../../infrastructure/scheduling/poll-loop.js";
import { env } from "../../config/env.js";
import { normalizeScheduledExecution } from "../normalizers/scheduling-normalizer.js";
import { ingestParsedEvent } from "../services/event-ingestion.service.js";

// scheduling-service's /internal/scheduler/executions is the best-shaped
// internal API among the siblings — it supports a scheduled_from/
// scheduled_to time-range filter, so this is the one poller that can query
// incrementally rather than by generous limit alone.
export function createSchedulingPoller(schedulingClient: SchedulingClient, catalogClient: CatalogClient, clock: Clock): PollLoop {
  let lastPolledTo: Date | null = null;

  return new PollLoop("scheduling", env.POLL_INTERVAL_SECONDS_SCHEDULING, async () => {
    const now = clock.now();
    const scheduledFrom = lastPolledTo ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const records = await schedulingClient.listExecutions({ scheduledFrom, scheduledTo: now, limit: 200 });
    for (const record of records) {
      const envelope = normalizeScheduledExecution(record);
      await ingestParsedEvent(envelope, catalogClient);
    }
    lastPolledTo = now;
  });
}
