import { beforeEach, describe, expect, it } from "vitest";
import { ingestParsedEvent } from "../../application/services/event-ingestion.service.js";
import { findExecutionById } from "../../infrastructure/persistence/execution.repository.js";
import { listStageRunsForExecution } from "../../infrastructure/persistence/stage-run.repository.js";
import { pool, truncateAll } from "../setup/db.js";
import { makeEnvelope } from "../fixtures/envelope-fixtures.js";
import { FakeCatalogClient } from "../fixtures/fake-catalog-client.js";

const catalogClient = new FakeCatalogClient();

beforeEach(async () => {
  await truncateAll();
});

describe("event ingestion — idempotency (spec section 6/37)", () => {
  it("creates exactly one execution and one stage run for a brand-new event", async () => {
    const envelope = makeEnvelope({
      eventId: "evt-fixed-1",
      source: { service: "data-exchange-service", entityType: "exchange", entityId: "exc-1" },
      correlation: { inboundExchangeId: "exc-1" },
      operation: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" },
    });

    const result = await ingestParsedEvent(envelope, catalogClient);
    expect(result.status).toBe("PERSISTED");
    expect(result.executionId).not.toBeNull();

    const stageRuns = await listStageRunsForExecution(pool, result.executionId!);
    expect(stageRuns).toHaveLength(1);
  });

  it("silently no-ops a duplicate event_id — never creates a second execution or stage run", async () => {
    const envelope = makeEnvelope({
      eventId: "evt-fixed-dup",
      source: { service: "data-exchange-service", entityType: "exchange", entityId: "exc-2" },
      correlation: { inboundExchangeId: "exc-2" },
      operation: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" },
    });

    const first = await ingestParsedEvent(envelope, catalogClient);
    const second = await ingestParsedEvent(envelope, catalogClient);

    expect(first.status).toBe("PERSISTED");
    expect(second.status).toBe("DUPLICATE");
    expect(second.executionId).toBe(first.executionId);

    const stageRuns = await listStageRunsForExecution(pool, first.executionId!);
    expect(stageRuns).toHaveLength(1);
  });

  it("handles an out-of-order / late-arriving event for the same stage by attempt number", async () => {
    const started = makeEnvelope({
      eventId: "evt-late-started",
      correlation: { inboundExchangeId: "exc-late" },
      operation: { stage: "EXCHANGE_RECEIVED", status: "RUNNING" },
      occurredAt: "2026-09-09T05:00:00.000Z",
    });
    const completed = makeEnvelope({
      eventId: "evt-late-completed",
      correlation: { inboundExchangeId: "exc-late" },
      operation: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" },
      occurredAt: "2026-09-09T05:03:00.000Z",
    });

    // Completed event arrives first (out of order), started arrives late.
    const r1 = await ingestParsedEvent(completed, catalogClient);
    const r2 = await ingestParsedEvent(started, catalogClient);
    expect(r1.executionId).toBe(r2.executionId);

    const stageRuns = await listStageRunsForExecution(pool, r1.executionId!);
    expect(stageRuns).toHaveLength(1);
    // The upsert preserves the already-recorded completedAt even though
    // the "started" event physically arrived second.
    expect(stageRuns[0]!.completedAt).not.toBeNull();

    const execution = await findExecutionById(pool, r1.executionId!);
    expect(execution!.inboundExchangeId).toBe("exc-late");
  });
});
