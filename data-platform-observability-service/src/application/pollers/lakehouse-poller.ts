import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { Clock } from "../../ports/clock.port.js";
import { PollLoop } from "../../infrastructure/scheduling/poll-loop.js";
import { env } from "../../config/env.js";
import { listIngestionRunsSince, listPipelineRunsSince, listQualityResultsSince } from "../../infrastructure/postgres/lakehouse-metadata-reader.js";
import { normalizeIngestionRun, normalizePipelineRun, normalizeQualityResult } from "../normalizers/lakehouse-normalizer.js";
import { ingestParsedEvent } from "../services/event-ingestion.service.js";

// Direct read-only Postgres adapter (plan section 3/9) — data-lakehouse's
// internal HTTP surface isn't built for incremental polling and this
// service follows the real precedent data-publication-service already
// established for the same database. Checkpoints are held in-memory per
// sub-table; the reconciliation loop is the authoritative backstop for
// anything missed across a restart.
export function createLakehousePoller(catalogClient: CatalogClient, clock: Clock): PollLoop {
  let ingestionCheckpoint: Date | null = null;
  let pipelineCheckpoint: Date | null = null;
  let qualityCheckpoint: Date | null = null;

  return new PollLoop("lakehouse", env.POLL_INTERVAL_SECONDS_LAKEHOUSE, async () => {
    const now = clock.now();
    const defaultLookback = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const ingestionRuns = await listIngestionRunsSince(ingestionCheckpoint ?? defaultLookback);
    for (const row of ingestionRuns) {
      await ingestParsedEvent(normalizeIngestionRun(row, "unresolved"), catalogClient);
    }
    if (ingestionRuns.length > 0) ingestionCheckpoint = ingestionRuns[ingestionRuns.length - 1]!.createdAt;

    const pipelineRuns = await listPipelineRunsSince(pipelineCheckpoint ?? defaultLookback);
    for (const row of pipelineRuns) {
      await ingestParsedEvent(normalizePipelineRun(row), catalogClient);
    }
    if (pipelineRuns.length > 0) pipelineCheckpoint = pipelineRuns[pipelineRuns.length - 1]!.createdAt;

    // quality_results carries only pipeline_run_id, not tenant/product
    // context of its own — resolved from this tick's (or a wider recent)
    // pipeline_runs read.
    const contextByPipelineRun = new Map(
      pipelineRuns.map((r) => [
        r.pipelineRunId,
        { organizationId: r.organizationId, tenantId: r.tenantId, dataProductId: r.dataProductId, productVersion: r.contractVersion ?? "unresolved" },
      ]),
    );

    const qualityResults = await listQualityResultsSince(qualityCheckpoint ?? defaultLookback);
    for (const row of qualityResults) {
      const context = contextByPipelineRun.get(row.pipelineRunId);
      if (!context) continue; // pipeline_run context not seen this tick or recently — reconciliation catches this on its next pass.
      await ingestParsedEvent(normalizeQualityResult(row, context), catalogClient);
    }
    if (qualityResults.length > 0) qualityCheckpoint = qualityResults[qualityResults.length - 1]!.evaluatedAt;
  });
}
