import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { PublicationClient } from "../../ports/publication-client.port.js";
import { PollLoop } from "../../infrastructure/scheduling/poll-loop.js";
import { env } from "../../config/env.js";
import { normalizePublicationRun } from "../normalizers/publication-normalizer.js";
import { ingestParsedEvent } from "../services/event-ingestion.service.js";

// /internal/v1/publications is limit-only, no since/cursor filter
// (confirmed against data-publication-service's routes.py) — same
// generous-limit + dedup + reconciliation approach as the exchange poller.
export function createPublicationPoller(publicationClient: PublicationClient, catalogClient: CatalogClient): PollLoop {
  return new PollLoop("publication", env.POLL_INTERVAL_SECONDS_PUBLICATION, async () => {
    const records = await publicationClient.listRecent(200);
    for (const record of records) {
      const envelope = normalizePublicationRun(record);
      await ingestParsedEvent(envelope, catalogClient);
    }
  });
}
