import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { ExchangeClient } from "../../ports/exchange-client.port.js";
import { PollLoop } from "../../infrastructure/scheduling/poll-loop.js";
import { env } from "../../config/env.js";
import { normalizeExchangeRecord } from "../normalizers/exchange-normalizer.js";
import { ingestParsedEvent } from "../services/event-ingestion.service.js";

// Exchange-service's internal list endpoint is limit-only (no since/cursor
// filter, plan section 9 reduction #1) — polled with a generous limit;
// event-id dedup (keyed by exchangeId+status) plus reconciliation is the
// correctness backstop for anything missed between ticks. product_version
// is unknown at this stage of the pipeline (exchange-service doesn't track
// it) — "unresolved" until Silver/Gold/publication resolves it (backfilled
// via correlation.service.ts once a downstream event supplies it).
export function createExchangePoller(exchangeClient: ExchangeClient, catalogClient: CatalogClient): PollLoop {
  return new PollLoop("exchange", env.POLL_INTERVAL_SECONDS_EXCHANGE, async () => {
    const records = await exchangeClient.listRecent({ limit: 200 });
    for (const record of records) {
      const envelope = normalizeExchangeRecord(record, "unresolved");
      await ingestParsedEvent(envelope, catalogClient);
    }
  });
}
