import { beforeEach, describe, expect, it } from "vitest";
import { ingestParsedEvent } from "../../application/services/event-ingestion.service.js";
import { findExecutionById } from "../../infrastructure/persistence/execution.repository.js";
import { listAlerts } from "../../infrastructure/persistence/alert.repository.js";
import { pool, truncateAll } from "../setup/db.js";
import { DEMO_ORG, DEMO_PRODUCT, DEMO_TENANT, DEMO_VERSION, makeEnvelope } from "../fixtures/envelope-fixtures.js";
import { FakeCatalogClient } from "../fixtures/fake-catalog-client.js";

// Required demonstration (spec sections 38-41): org-vobis-org-722aea /
// tenant-default-47d849 / event-performance. Implemented as a synthetic
// event-fixture replay through this service's own real ingestion/
// correlation/SLA/alert/health pipeline (ingestParsedEvent), per the
// implementation plan's scoping decision — not a live 9-service
// docker-compose orchestration.
//
// Timestamps are offsets from the moment the test runs (not fixed
// calendar times) — stuck-run detection and the AT_RISK branch of SLA
// evaluation compare a stage's recorded startedAt against real wall-clock
// "now" at evaluation time, so anchoring to the actual run time (rather
// than a hardcoded past date) keeps the scenario deterministic regardless
// of when the suite executes. The business deadline is expressed in the
// service's supported relative form (T+<n>m) for the same reason — the
// absolute "daily 06:00 UTC" example in the spec narrative is exercised
// deterministically instead by sla-evaluation.integration.test.ts, which
// controls its own fixed timestamps end-to-end.
const catalogClient = new FakeCatalogClient();

const DECLARED_SLA = {
  version: DEMO_VERSION,
  lifecycleStatus: "ACTIVE",
  sla: {
    freshnessMinutes: 240,
    availabilityTargetPercent: 99.9,
    maximumPublicationLatencyMinutes: 15,
    deliveryDeadlineExpression: "T+45m",
  },
};

beforeEach(async () => {
  await truncateAll();
  catalogClient.setVersionDetail(DECLARED_SLA);
});

function iso(baseTime: Date, offsetMinutes: number): string {
  return new Date(baseTime.getTime() + offsetMinutes * 60_000).toISOString();
}

async function ingest(overrides: Parameters<typeof makeEnvelope>[0]) {
  return ingestParsedEvent(makeEnvelope(overrides), catalogClient);
}

describe("Vobis demonstration — event-performance / org-vobis-org-722aea / tenant-default-47d849", () => {
  it("scenario (a): a full on-time execution PASSes technical + business SLA and is HEALTHY (spec section 38)", async () => {
    const t0 = new Date();
    const exchangeId = "exc-demo-a";
    const ingestionId = "ing-demo-a";
    const silverRunId = "run-silver-demo-a";
    const goldRunId = "run-gold-demo-a";
    const publicationId = "pub-demo-a";
    const outboundId = "exc-demo-a-out";

    await ingest({ eventId: "a-1", correlation: { inboundExchangeId: exchangeId }, operation: { stage: "EXCHANGE_RECEIVED", status: "RUNNING" }, occurredAt: iso(t0, 0) });
    await ingest({ eventId: "a-2", correlation: { inboundExchangeId: exchangeId }, operation: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" }, occurredAt: iso(t0, 0.5) });
    await ingest({ eventId: "a-3", correlation: { inboundExchangeId: exchangeId }, operation: { stage: "EXCHANGE_VALIDATION", status: "RUNNING" }, occurredAt: iso(t0, 0.5) });
    await ingest({ eventId: "a-4", correlation: { inboundExchangeId: exchangeId }, operation: { stage: "EXCHANGE_VALIDATION", status: "SUCCEEDED" }, occurredAt: iso(t0, 3) });

    await ingest({ eventId: "a-5", correlation: { inboundExchangeId: exchangeId, ingestionId }, operation: { stage: "BRONZE_INGESTION", status: "RUNNING" }, occurredAt: iso(t0, 5) });
    await ingest({ eventId: "a-6", correlation: { ingestionId }, operation: { stage: "BRONZE_INGESTION", status: "SUCCEEDED" }, occurredAt: iso(t0, 8) });

    await ingest({ eventId: "a-7", correlation: { ingestionId, silverPipelineRunId: silverRunId }, operation: { stage: "SILVER_TRANSFORMATION", status: "RUNNING" }, occurredAt: iso(t0, 9) });
    await ingest({ eventId: "a-8", correlation: { silverPipelineRunId: silverRunId }, operation: { stage: "SILVER_TRANSFORMATION", status: "SUCCEEDED" }, occurredAt: iso(t0, 16) });

    await ingest({ eventId: "a-9", correlation: { silverPipelineRunId: silverRunId, goldPipelineRunId: goldRunId }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING" }, occurredAt: iso(t0, 17) });
    await ingest({ eventId: "a-10", correlation: { goldPipelineRunId: goldRunId }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED" }, occurredAt: iso(t0, 24) });

    await ingest({ eventId: "a-11a", correlation: { goldPipelineRunId: goldRunId }, operation: { stage: "QUALITY_VALIDATION", status: "RUNNING" }, occurredAt: iso(t0, 24.25) });
    await ingest({ eventId: "a-11", correlation: { goldPipelineRunId: goldRunId }, operation: { stage: "QUALITY_VALIDATION", status: "SUCCEEDED" }, occurredAt: iso(t0, 24.5) });

    await ingest({ eventId: "a-12", correlation: { goldPipelineRunId: goldRunId, publicationId }, operation: { stage: "PUBLICATION", status: "RUNNING" }, occurredAt: iso(t0, 25) });
    await ingest({ eventId: "a-13", correlation: { publicationId, outboundExchangeId: outboundId }, operation: { stage: "PUBLICATION", status: "SUCCEEDED" }, occurredAt: iso(t0, 31) });

    await ingest({ eventId: "a-14", correlation: { outboundExchangeId: outboundId }, operation: { stage: "OUTBOUND_EXCHANGE", status: "RUNNING" }, occurredAt: iso(t0, 32) });
    const final = await ingest({ eventId: "a-15", correlation: { outboundExchangeId: outboundId }, operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" }, occurredAt: iso(t0, 33) });

    const execution = await findExecutionById(pool, final.executionId!);
    expect(execution!.overallStatus).toBe("SUCCEEDED");
    expect(execution!.technicalSlaStatus).toBe("PASS");
    expect(execution!.businessSlaStatus).toBe("PASS");
    expect(execution!.healthStatus).toBe("HEALTHY");

    const alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    expect(alerts).toHaveLength(0);
  });

  it("scenario (b): delayed publication breaches business SLA, opens an alert, and degrades health (spec section 39)", async () => {
    const t0 = new Date();
    const goldRunId = "run-gold-demo-b";
    const publicationId = "pub-demo-b";
    const outboundId = "exc-demo-b-out";

    // A shorter deadline than scenario (a)'s, relative to when this
    // abbreviated execution's own first stage started — Gold and
    // Publication each individually finish within their own technical
    // stage targets, but the OVERALL customer-facing deadline is still
    // missed by 8 minutes, the same "technical processing was fine, the
    // business deadline was still missed" contrast the spec's own section
    // 39 example illustrates.
    catalogClient.setVersionDetail({ ...DECLARED_SLA, sla: { ...DECLARED_SLA.sla, deliveryDeadlineExpression: "T+15m" } });

    await ingest({ eventId: "b-1", correlation: { goldPipelineRunId: goldRunId }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING" }, occurredAt: iso(t0, 0) });
    await ingest({ eventId: "b-2", correlation: { goldPipelineRunId: goldRunId }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED" }, occurredAt: iso(t0, 13) });

    await ingest({ eventId: "b-3", correlation: { goldPipelineRunId: goldRunId, publicationId }, operation: { stage: "PUBLICATION", status: "RUNNING" }, occurredAt: iso(t0, 14) });
    await ingest({ eventId: "b-4", correlation: { publicationId, outboundExchangeId: outboundId }, operation: { stage: "PUBLICATION", status: "SUCCEEDED" }, occurredAt: iso(t0, 23) });

    const final = await ingest({ eventId: "b-5", correlation: { outboundExchangeId: outboundId }, operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" }, occurredAt: iso(t0, 23) });

    const execution = await findExecutionById(pool, final.executionId!);
    expect(execution!.businessSlaStatus).toBe("FAIL");
    expect(execution!.healthStatus).not.toBe("HEALTHY");

    const alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const businessAlert = alerts.find((a) => a.alertType === "BUSINESS_SLA_BREACHED");
    expect(businessAlert?.state).toBe("OPEN");
    expect(businessAlert?.description).toMatch(/8 minutes/);
  });

  it("scenario (c): the next on-time execution PASSes again, resolves the prior alert, and restores HEALTHY — without erasing history (spec section 40)", async () => {
    const t0 = new Date();
    catalogClient.setVersionDetail({ ...DECLARED_SLA, sla: { ...DECLARED_SLA.sla, deliveryDeadlineExpression: "T+15m" } });

    // Replay scenario (b) first so there is a prior OPEN alert to recover from.
    const goldRunIdB = "run-gold-demo-c-prior";
    const publicationIdB = "pub-demo-c-prior";
    const outboundIdB = "exc-demo-c-prior-out";
    await ingest({ eventId: "c-prior-1", correlation: { goldPipelineRunId: goldRunIdB }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING" }, occurredAt: iso(t0, 0) });
    await ingest({ eventId: "c-prior-2", correlation: { goldPipelineRunId: goldRunIdB }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED" }, occurredAt: iso(t0, 13) });
    await ingest({ eventId: "c-prior-3", correlation: { goldPipelineRunId: goldRunIdB, publicationId: publicationIdB, outboundExchangeId: outboundIdB }, operation: { stage: "PUBLICATION", status: "SUCCEEDED" }, occurredAt: iso(t0, 23) });
    await ingest({ eventId: "c-prior-4", correlation: { outboundExchangeId: outboundIdB }, operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" }, occurredAt: iso(t0, 23) });

    const priorAlerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const priorAlert = priorAlerts.find((a) => a.alertType === "BUSINESS_SLA_BREACHED");
    expect(priorAlert?.state).toBe("OPEN");

    // A later execution in the same scope completes well ahead of the
    // T+15m deadline this time (13 minutes end-to-end from Gold start).
    const t1 = new Date();
    const goldRunIdC = "run-gold-demo-c-recovery";
    const publicationIdC = "pub-demo-c-recovery";
    const outboundIdC = "exc-demo-c-recovery-out";
    await ingest({ eventId: "c-recover-1", correlation: { goldPipelineRunId: goldRunIdC }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "RUNNING" }, occurredAt: iso(t1, 0) });
    await ingest({ eventId: "c-recover-2", correlation: { goldPipelineRunId: goldRunIdC }, operation: { stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED" }, occurredAt: iso(t1, 8) });
    await ingest({ eventId: "c-recover-3", correlation: { goldPipelineRunId: goldRunIdC, publicationId: publicationIdC }, operation: { stage: "PUBLICATION", status: "RUNNING" }, occurredAt: iso(t1, 9) });
    await ingest({ eventId: "c-recover-4", correlation: { publicationId: publicationIdC, outboundExchangeId: outboundIdC }, operation: { stage: "PUBLICATION", status: "SUCCEEDED" }, occurredAt: iso(t1, 13) });
    const recovered = await ingest({ eventId: "c-recover-5", correlation: { outboundExchangeId: outboundIdC }, operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" }, occurredAt: iso(t1, 13) });

    const recoveredExecution = await findExecutionById(pool, recovered.executionId!);
    expect(recoveredExecution!.businessSlaStatus).toBe("PASS");
    expect(recoveredExecution!.healthStatus).toBe("HEALTHY");

    const alertsAfterRecovery = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const resolvedPriorAlert = alertsAfterRecovery.find((a) => a.alertId === priorAlert!.alertId);
    // Same row (history preserved, spec section 40), now RESOLVED.
    expect(resolvedPriorAlert).toBeDefined();
    expect(resolvedPriorAlert!.state).toBe("RESOLVED");
  });

  it("tenant isolation demonstration: tenant-observability-test-b never appears in tenant-default-47d849's data (spec section 41)", async () => {
    const OTHER_TENANT = "tenant-observability-test-b";
    await ingest({ eventId: "iso-demo-a", correlation: { publicationId: "pub-iso-demo-a" }, operation: { stage: "PUBLICATION", status: "SUCCEEDED" } });
    await ingest({
      eventId: "iso-demo-b",
      context: { organizationId: DEMO_ORG, tenantId: OTHER_TENANT },
      correlation: { publicationId: "pub-iso-demo-b" },
      operation: { stage: "PUBLICATION", status: "FAILED" },
    });

    const tenantAAlerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    expect(tenantAAlerts.every((a) => a.tenantId === DEMO_TENANT)).toBe(true);

    const tenantBAlerts = await listAlerts(pool, { tenantId: OTHER_TENANT, dataProductId: DEMO_PRODUCT });
    expect(tenantBAlerts.every((a) => a.tenantId === OTHER_TENANT)).toBe(true);
    expect(tenantBAlerts.length).toBeGreaterThan(0);
  });
});
