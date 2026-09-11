import { beforeEach, describe, expect, it } from "vitest";
import { ingestParsedEvent } from "../../application/services/event-ingestion.service.js";
import { findExecutionById } from "../../infrastructure/persistence/execution.repository.js";
import { listEvaluationsForExecution } from "../../infrastructure/persistence/sla-evaluation.repository.js";
import { pool, truncateAll } from "../setup/db.js";
import { makeEnvelope } from "../fixtures/envelope-fixtures.js";
import { FakeCatalogClient } from "../fixtures/fake-catalog-client.js";

const catalogClient = new FakeCatalogClient();

beforeEach(async () => {
  await truncateAll();
  catalogClient.setVersionDetail(null);
});

describe("SLA evaluation — technical (per-stage target, spec section 10)", () => {
  it("PASSes a stage that completes within its configured target", async () => {
    const started = "2026-09-09T05:17:00.000Z";
    const completed = "2026-09-09T05:24:00.000Z"; // 7 minutes, default GOLD_PRODUCT_BUILD target is 15

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "tech-pass-start",
        correlation: { goldPipelineRunId: "run-tech-pass" },
        operation: { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING" },
        occurredAt: started,
      }),
      catalogClient,
    );
    const result = await ingestParsedEvent(
      makeEnvelope({
        eventId: "tech-pass-complete",
        correlation: { goldPipelineRunId: "run-tech-pass" },
        operation: { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED" },
        occurredAt: completed,
      }),
      catalogClient,
    );

    const evaluations = await listEvaluationsForExecution(pool, result.executionId!);
    const stageEval = evaluations.find((e) => e.stage === "GOLD_PRODUCT_BUILD");
    expect(stageEval?.status).toBe("PASS");
  });

  it("FAILs a stage that overruns its configured target, with a breach duration", async () => {
    const started = "2026-09-09T05:17:00.000Z";
    const completed = "2026-09-09T05:40:00.000Z"; // 23 minutes, default target 15 -> 8 min breach

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "tech-fail-start",
        correlation: { goldPipelineRunId: "run-tech-fail" },
        operation: { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING" },
        occurredAt: started,
      }),
      catalogClient,
    );
    const result = await ingestParsedEvent(
      makeEnvelope({
        eventId: "tech-fail-complete",
        correlation: { goldPipelineRunId: "run-tech-fail" },
        operation: { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED" },
        occurredAt: completed,
      }),
      catalogClient,
    );

    const evaluations = await listEvaluationsForExecution(pool, result.executionId!);
    const stageEval = evaluations.find((e) => e.stage === "GOLD_PRODUCT_BUILD");
    expect(stageEval?.status).toBe("FAIL");
    expect(stageEval?.breachDurationSeconds).toBe(8 * 60);

    const execution = await findExecutionById(pool, result.executionId!);
    expect(execution!.technicalSlaStatus).toBe("FAIL");
  });
});

describe("SLA evaluation — business (customer delivery deadline, spec section 11)", () => {
  it("PASSes when delivery completes before catalog's declared deadline", async () => {
    catalogClient.setVersionDetail({
      version: "1.3.0",
      lifecycleStatus: "ACTIVE",
      sla: { freshnessMinutes: 240, availabilityTargetPercent: 99.9, maximumPublicationLatencyMinutes: 30, deliveryDeadlineExpression: "T+4h" },
    });

    const start = await ingestParsedEvent(
      makeEnvelope({
        eventId: "biz-pass-start",
        correlation: { inboundExchangeId: "exc-biz-pass" },
        operation: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" },
        occurredAt: "2026-09-09T01:00:00.000Z",
      }),
      catalogClient,
    );
    const executionId = start.executionId!;

    const result = await ingestParsedEvent(
      makeEnvelope({
        eventId: "biz-pass-delivered",
        correlation: { inboundExchangeId: "exc-biz-pass", outboundExchangeId: "exc-biz-pass-out" },
        operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
        occurredAt: "2026-09-09T04:30:00.000Z", // within T+4h of 01:00
      }),
      catalogClient,
    );
    expect(result.executionId).toBe(executionId);

    const execution = await findExecutionById(pool, executionId);
    expect(execution!.businessSlaStatus).toBe("PASS");
  });

  it("FAILs with a breach duration when delivery completes after the deadline (spec section 39 scenario)", async () => {
    catalogClient.setVersionDetail({
      version: "1.3.0",
      lifecycleStatus: "ACTIVE",
      sla: { freshnessMinutes: 240, availabilityTargetPercent: 99.9, maximumPublicationLatencyMinutes: 30, deliveryDeadlineExpression: "daily 06:00 UTC" },
    });

    const start = await ingestParsedEvent(
      makeEnvelope({
        eventId: "biz-fail-start",
        correlation: { inboundExchangeId: "exc-biz-fail" },
        operation: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" },
        occurredAt: "2026-09-09T05:00:00.000Z",
      }),
      catalogClient,
    );
    const executionId = start.executionId!;

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "biz-fail-delivered",
        correlation: { inboundExchangeId: "exc-biz-fail", outboundExchangeId: "exc-biz-fail-out" },
        operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
        occurredAt: "2026-09-09T06:08:00.000Z", // 8 minutes after the 06:00 UTC deadline
      }),
      catalogClient,
    );

    const evaluations = await listEvaluationsForExecution(pool, executionId);
    const businessEval = evaluations.find((e) => e.slaType === "BUSINESS");
    expect(businessEval?.status).toBe("FAIL");
    expect(businessEval?.breachDurationSeconds).toBe(8 * 60);

    const execution = await findExecutionById(pool, executionId);
    expect(execution!.businessSlaStatus).toBe("FAIL");
  });

  it("is NOT_APPLICABLE when catalog declares no SLA for this product/version", async () => {
    catalogClient.setVersionDetail(null);
    const result = await ingestParsedEvent(
      makeEnvelope({
        eventId: "biz-na",
        correlation: { outboundExchangeId: "exc-biz-na" },
        operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
      }),
      catalogClient,
    );
    const execution = await findExecutionById(pool, result.executionId!);
    expect(execution!.businessSlaStatus).toBe("NOT_APPLICABLE");
  });
});
