import { beforeEach, describe, expect, it } from "vitest";
import { ingestParsedEvent } from "../../application/services/event-ingestion.service.js";
import { findExecutionById } from "../../infrastructure/persistence/execution.repository.js";
import { listStageRunsForExecution } from "../../infrastructure/persistence/stage-run.repository.js";
import { pool, truncateAll } from "../setup/db.js";
import { DEMO_PRODUCT, DEMO_TENANT, makeEnvelope } from "../fixtures/envelope-fixtures.js";
import { FakeCatalogClient } from "../fixtures/fake-catalog-client.js";

const catalogClient = new FakeCatalogClient();

beforeEach(async () => {
  await truncateAll();
});

describe("correlation — full ID chain across independently-generated identifiers (plan section 5)", () => {
  it("stitches exchange -> ingestion -> silver -> gold -> publication -> outbound into ONE execution", async () => {
    const exchangeId = "exc-chain-1";
    const ingestionId = "ing-chain-1";
    const silverRunId = "run-silver-chain-1";
    const goldRunId = "run-gold-chain-1";
    const publicationId = "pub-chain-1";
    const outboundId = "exc-chain-outbound-1";

    // Each event only carries the identifiers that specific sibling would
    // actually know about — never the full chain at once — exactly like
    // real cross-service data.
    await ingestParsedEvent(
      makeEnvelope({
        eventId: "e1",
        source: { service: "data-exchange-service", entityType: "exchange", entityId: exchangeId },
        correlation: { inboundExchangeId: exchangeId },
        operation: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "e2",
        source: { service: "data-lakehouse", entityType: "ingestion_run", entityId: ingestionId },
        correlation: { inboundExchangeId: exchangeId, ingestionId },
        operation: { stage: "BRONZE_INGESTION", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "e3",
        source: { service: "data-lakehouse", entityType: "pipeline_run", entityId: silverRunId },
        correlation: { ingestionId, silverPipelineRunId: silverRunId },
        operation: { stage: "SILVER_TRANSFORMATION", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "e4",
        source: { service: "data-lakehouse", entityType: "pipeline_run", entityId: goldRunId },
        correlation: { silverPipelineRunId: silverRunId, goldPipelineRunId: goldRunId },
        operation: { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "e5",
        source: { service: "data-publication-service", entityType: "publication_run", entityId: publicationId },
        correlation: { goldPipelineRunId: goldRunId, publicationId, outboundExchangeId: outboundId },
        operation: { stage: "PUBLICATION", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    const final = await ingestParsedEvent(
      makeEnvelope({
        eventId: "e6",
        source: { service: "data-exchange-service", entityType: "exchange", entityId: outboundId },
        correlation: { outboundExchangeId: outboundId },
        operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    const executionId = final.executionId!;
    const execution = await findExecutionById(pool, executionId);
    expect(execution!.inboundExchangeId).toBe(exchangeId);
    expect(execution!.ingestionId).toBe(ingestionId);
    expect(execution!.silverPipelineRunId).toBe(silverRunId);
    expect(execution!.goldPipelineRunId).toBe(goldRunId);
    expect(execution!.publicationId).toBe(publicationId);
    expect(execution!.outboundExchangeId).toBe(outboundId);
    expect(execution!.overallStatus).toBe("SUCCEEDED");

    const stageRuns = await listStageRunsForExecution(pool, executionId);
    expect(stageRuns).toHaveLength(6);
  });

  it("uses the heuristic scope+time-window fallback for a genuinely ad hoc execution with no prior identifiers", async () => {
    const result = await ingestParsedEvent(
      makeEnvelope({
        eventId: "adhoc-1",
        context: { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT },
        source: { service: "data-publication-service", entityType: "publication_run", entityId: "pub-adhoc" },
        correlation: { publicationId: "pub-adhoc" },
        operation: { stage: "PUBLICATION", status: "RUNNING" },
      }),
      catalogClient,
    );
    expect(result.executionId).not.toBeNull();

    // A second, unrelated event in the same scope with no shared
    // identifier attaches heuristically to the same still-open execution
    // rather than creating a spurious new one.
    const followUp = await ingestParsedEvent(
      makeEnvelope({
        eventId: "adhoc-2",
        context: { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT },
        source: { service: "data-exchange-service", entityType: "exchange", entityId: "exc-adhoc" },
        correlation: { outboundExchangeId: "exc-adhoc" },
        operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
      }),
      catalogClient,
    );
    expect(followUp.executionId).toBe(result.executionId);
  });

  it("creates a distinct execution when scope matches but the prior execution has already completed", async () => {
    const first = await ingestParsedEvent(
      makeEnvelope({
        eventId: "distinct-1",
        context: { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT },
        correlation: { publicationId: "pub-distinct-1", outboundExchangeId: "exc-distinct-1" },
        operation: { stage: "PUBLICATION", status: "SUCCEEDED" },
      }),
      catalogClient,
    );
    // Reaches a delivery-terminal stage so the execution's completed_at
    // gets set — otherwise it would still read as "open" and the second
    // event below would (correctly) attach to it heuristically instead.
    await ingestParsedEvent(
      makeEnvelope({
        eventId: "distinct-1b",
        context: { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT },
        correlation: { outboundExchangeId: "exc-distinct-1" },
        operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    const second = await ingestParsedEvent(
      makeEnvelope({
        eventId: "distinct-2",
        context: { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT },
        correlation: { publicationId: "pub-distinct-2" },
        operation: { stage: "PUBLICATION", status: "SUCCEEDED" },
      }),
      catalogClient,
    );
    expect(second.executionId).not.toBe(first.executionId);
  });
});
