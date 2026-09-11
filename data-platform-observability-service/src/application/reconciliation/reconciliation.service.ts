import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { ExchangeClient } from "../../ports/exchange-client.port.js";
import type { PublicationClient } from "../../ports/publication-client.port.js";
import type { Clock } from "../../ports/clock.port.js";
import { pool } from "../../database/pool.js";
import { generateReconciliationRunId } from "../../common/ids/id-generator.js";
import { completeReconciliationRun, startReconciliationRun } from "../../infrastructure/persistence/reconciliation-run.repository.js";
import { listIngestionRunsSince, listPipelineRunsSince } from "../../infrastructure/postgres/lakehouse-metadata-reader.js";
import { normalizeExchangeRecord } from "../normalizers/exchange-normalizer.js";
import { normalizeIngestionRun, normalizePipelineRun } from "../normalizers/lakehouse-normalizer.js";
import { normalizePublicationRun } from "../normalizers/publication-normalizer.js";
import { ingestParsedEvent } from "../services/event-ingestion.service.js";
import { logger } from "../../common/logger/logger.js";

// Re-pulls each authoritative source over a bounded recent window and
// replays it through the SAME event-ingestion pipeline used by live
// polling/push (plan section 4) — never a separate write path, so a
// reconciliation-repaired event gets identical dedup/correlate/persist/
// evaluate guarantees. Never mutates any sibling's own state — read-only
// against siblings, write-only against this service's own tables. A
// "PERSISTED" outcome for an event this pass hadn't already recorded is
// counted as repaired drift (late/missed/out-of-order event now caught up);
// a "DUPLICATE" outcome confirms no drift existed for that record.
export interface ReconciliationAdapters {
  exchangeClient: ExchangeClient;
  publicationClient: PublicationClient;
  catalogClient: CatalogClient;
  clock: Clock;
}

async function reconcileAdapter(
  adapterName: string,
  scan: () => Promise<Array<{ persisted: boolean }>>,
): Promise<void> {
  const reconciliationRunId = generateReconciliationRunId();
  await startReconciliationRun(pool, reconciliationRunId, adapterName);
  try {
    const results = await scan();
    const driftRepaired = results.filter((r) => r.persisted).length;
    await completeReconciliationRun(pool, {
      reconciliationRunId,
      status: "SUCCEEDED",
      recordsScanned: results.length,
      driftDetectedCount: driftRepaired,
      driftRepairedCount: driftRepaired,
      errorMessage: null,
    });
  } catch (err) {
    logger.error({ err, adapterName }, "reconciliation pass failed");
    await completeReconciliationRun(pool, {
      reconciliationRunId,
      status: "FAILED",
      recordsScanned: 0,
      driftDetectedCount: 0,
      driftRepairedCount: 0,
      errorMessage: (err as Error).message,
    });
  }
}

export async function runReconciliationPass(adapters: ReconciliationAdapters, lookbackHours: number): Promise<void> {
  const now = adapters.clock.now();
  const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

  await reconcileAdapter("exchange", async () => {
    const records = await adapters.exchangeClient.listRecent({ limit: 500 });
    const results = [];
    for (const record of records.filter((r) => r.createdAt > since)) {
      const outcome = await ingestParsedEvent(normalizeExchangeRecord(record, "unresolved"), adapters.catalogClient);
      results.push({ persisted: outcome.status === "PERSISTED" });
    }
    return results;
  });

  await reconcileAdapter("publication", async () => {
    const records = await adapters.publicationClient.listRecent(500);
    const results = [];
    for (const record of records.filter((r) => (r.completedAt ?? r.startedAt ?? now) > since)) {
      const outcome = await ingestParsedEvent(normalizePublicationRun(record), adapters.catalogClient);
      results.push({ persisted: outcome.status === "PERSISTED" });
    }
    return results;
  });

  await reconcileAdapter("lakehouse", async () => {
    const results = [];
    for (const row of await listIngestionRunsSince(since)) {
      const outcome = await ingestParsedEvent(normalizeIngestionRun(row, "unresolved"), adapters.catalogClient);
      results.push({ persisted: outcome.status === "PERSISTED" });
    }
    for (const row of await listPipelineRunsSince(since)) {
      const outcome = await ingestParsedEvent(normalizePipelineRun(row), adapters.catalogClient);
      results.push({ persisted: outcome.status === "PERSISTED" });
    }
    return results;
  });
}
