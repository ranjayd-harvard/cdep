// Runnable demonstration script (spec sections 38-41): replays the same
// three-scenario narrative as src/tests/e2e/vobis-demo.test.ts — happy
// path, delayed-publication business-SLA breach, and recovery — plus a
// tenant-isolation scenario, against a REAL running instance (its own
// Postgres via the same ingestParsedEvent pipeline every push/poll event
// goes through). Safe to run repeatedly: every event has a unique id, and
// the correlation/dedup mechanics are the same idempotent ones used in
// production.
//
// Usage: npm run seed-demo
import { ingestParsedEvent } from "../src/application/services/event-ingestion.service.js";
import { pool } from "../src/database/pool.js";
import { logger } from "../src/common/logger/logger.js";
import type { CatalogClient, CatalogVersionDetail } from "../src/ports/catalog-client.port.js";
import type { EventEnvelope } from "../src/application/dto/event-envelope.dto.js";

const ORG = "org-vobis-org-722aea";
const TENANT = "tenant-default-47d849";
const OTHER_TENANT = "tenant-observability-test-b";
const PRODUCT = "event-performance";
const VERSION = "1.3.0";

class SeedCatalogClient implements CatalogClient {
  constructor(private detail: CatalogVersionDetail) {}
  async getVersionDetail(): Promise<CatalogVersionDetail | null> {
    return this.detail;
  }
  async listVersions() {
    return [{ version: this.detail.version, lifecycleStatus: this.detail.lifecycleStatus }];
  }
  async listMigrations() {
    return [];
  }
}

function iso(base: Date, offsetMinutes: number): string {
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString();
}

function envelope(overrides: {
  eventId: string;
  tenantId?: string;
  correlation?: EventEnvelope["correlation"];
  stage: EventEnvelope["operation"]["stage"];
  status: EventEnvelope["operation"]["status"];
  occurredAt: string;
}): EventEnvelope {
  return {
    eventId: overrides.eventId,
    eventType: `${overrides.stage}_${overrides.status}`,
    occurredAt: overrides.occurredAt,
    source: { service: "seed-demo-script", entityType: "demo", entityId: overrides.eventId },
    context: {
      organizationId: ORG,
      tenantId: overrides.tenantId ?? TENANT,
      dataProductId: PRODUCT,
      productVersion: VERSION,
    },
    correlation: overrides.correlation ?? {},
    operation: { stage: overrides.stage, status: overrides.status, attempt: 1 },
    metrics: {},
    metadata: {},
  };
}

async function main() {
  const catalogClient = new SeedCatalogClient({
    version: VERSION,
    lifecycleStatus: "ACTIVE",
    sla: { freshnessMinutes: 240, availabilityTargetPercent: 99.9, maximumPublicationLatencyMinutes: 15, deliveryDeadlineExpression: "T+45m" },
  });

  logger.info("Seeding scenario (a): full on-time execution — technical PASS, business PASS, HEALTHY");
  {
    const t0 = new Date();
    const exchangeId = "exc-seed-a";
    const ingestionId = "ing-seed-a";
    const silverRunId = "run-silver-seed-a";
    const goldRunId = "run-gold-seed-a";
    const publicationId = "pub-seed-a";
    const outboundId = "exc-seed-a-out";

    const steps: EventEnvelope[] = [
      envelope({ eventId: "seed-a-1", correlation: { inboundExchangeId: exchangeId }, stage: "EXCHANGE_RECEIVED", status: "RUNNING", occurredAt: iso(t0, 0) }),
      envelope({ eventId: "seed-a-2", correlation: { inboundExchangeId: exchangeId }, stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED", occurredAt: iso(t0, 0.5) }),
      envelope({ eventId: "seed-a-3", correlation: { inboundExchangeId: exchangeId }, stage: "EXCHANGE_VALIDATION", status: "RUNNING", occurredAt: iso(t0, 0.5) }),
      envelope({ eventId: "seed-a-4", correlation: { inboundExchangeId: exchangeId }, stage: "EXCHANGE_VALIDATION", status: "SUCCEEDED", occurredAt: iso(t0, 3) }),
      envelope({ eventId: "seed-a-5", correlation: { inboundExchangeId: exchangeId, ingestionId }, stage: "BRONZE_INGESTION", status: "RUNNING", occurredAt: iso(t0, 5) }),
      envelope({ eventId: "seed-a-6", correlation: { ingestionId }, stage: "BRONZE_INGESTION", status: "SUCCEEDED", occurredAt: iso(t0, 8) }),
      envelope({ eventId: "seed-a-7", correlation: { ingestionId, silverPipelineRunId: silverRunId }, stage: "SILVER_TRANSFORMATION", status: "RUNNING", occurredAt: iso(t0, 9) }),
      envelope({ eventId: "seed-a-8", correlation: { silverPipelineRunId: silverRunId }, stage: "SILVER_TRANSFORMATION", status: "SUCCEEDED", occurredAt: iso(t0, 16) }),
      envelope({ eventId: "seed-a-9", correlation: { silverPipelineRunId: silverRunId, goldPipelineRunId: goldRunId }, stage: "GOLD_PRODUCT_BUILD", status: "RUNNING", occurredAt: iso(t0, 17) }),
      envelope({ eventId: "seed-a-10", correlation: { goldPipelineRunId: goldRunId }, stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED", occurredAt: iso(t0, 24) }),
      envelope({ eventId: "seed-a-11a", correlation: { goldPipelineRunId: goldRunId }, stage: "QUALITY_VALIDATION", status: "RUNNING", occurredAt: iso(t0, 24.25) }),
      envelope({ eventId: "seed-a-11", correlation: { goldPipelineRunId: goldRunId }, stage: "QUALITY_VALIDATION", status: "SUCCEEDED", occurredAt: iso(t0, 24.5) }),
      envelope({ eventId: "seed-a-12", correlation: { goldPipelineRunId: goldRunId, publicationId }, stage: "PUBLICATION", status: "RUNNING", occurredAt: iso(t0, 25) }),
      envelope({ eventId: "seed-a-13", correlation: { publicationId, outboundExchangeId: outboundId }, stage: "PUBLICATION", status: "SUCCEEDED", occurredAt: iso(t0, 31) }),
      envelope({ eventId: "seed-a-14", correlation: { outboundExchangeId: outboundId }, stage: "OUTBOUND_EXCHANGE", status: "RUNNING", occurredAt: iso(t0, 32) }),
      envelope({ eventId: "seed-a-15", correlation: { outboundExchangeId: outboundId }, stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED", occurredAt: iso(t0, 33) }),
    ];
    let executionId: string | null = null;
    for (const step of steps) {
      const result = await ingestParsedEvent(step, catalogClient);
      executionId = result.executionId;
    }
    logger.info({ executionId }, "scenario (a) seeded");
  }

  logger.info("Seeding scenario (b): delayed publication — business SLA breach, alert opens, health degrades");
  let scenarioBExecutionId: string | null = null;
  {
    const t0 = new Date();
    const goldRunId = "run-gold-seed-b";
    const publicationId = "pub-seed-b";
    const outboundId = "exc-seed-b-out";
    const shortDeadlineCatalog = new SeedCatalogClient({
      version: VERSION,
      lifecycleStatus: "ACTIVE",
      sla: { freshnessMinutes: 240, availabilityTargetPercent: 99.9, maximumPublicationLatencyMinutes: 15, deliveryDeadlineExpression: "T+15m" },
    });
    const steps: EventEnvelope[] = [
      envelope({ eventId: "seed-b-1", correlation: { goldPipelineRunId: goldRunId }, stage: "GOLD_PRODUCT_BUILD", status: "RUNNING", occurredAt: iso(t0, 0) }),
      envelope({ eventId: "seed-b-2", correlation: { goldPipelineRunId: goldRunId }, stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED", occurredAt: iso(t0, 13) }),
      envelope({ eventId: "seed-b-3", correlation: { goldPipelineRunId: goldRunId, publicationId }, stage: "PUBLICATION", status: "RUNNING", occurredAt: iso(t0, 14) }),
      envelope({ eventId: "seed-b-4", correlation: { publicationId, outboundExchangeId: outboundId }, stage: "PUBLICATION", status: "SUCCEEDED", occurredAt: iso(t0, 23) }),
      envelope({ eventId: "seed-b-5", correlation: { outboundExchangeId: outboundId }, stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED", occurredAt: iso(t0, 23) }),
    ];
    for (const step of steps) {
      const result = await ingestParsedEvent(step, shortDeadlineCatalog);
      scenarioBExecutionId = result.executionId;
    }
    logger.info({ executionId: scenarioBExecutionId }, "scenario (b) seeded — expect business_sla_status=FAIL, an OPEN BUSINESS_SLA_BREACHED alert");
  }

  logger.info("Seeding scenario (c): on-time recovery — resolves the prior alert, restores HEALTHY, preserves history");
  {
    const t1 = new Date();
    const goldRunId = "run-gold-seed-c";
    const publicationId = "pub-seed-c";
    const outboundId = "exc-seed-c-out";
    const shortDeadlineCatalog = new SeedCatalogClient({
      version: VERSION,
      lifecycleStatus: "ACTIVE",
      sla: { freshnessMinutes: 240, availabilityTargetPercent: 99.9, maximumPublicationLatencyMinutes: 15, deliveryDeadlineExpression: "T+15m" },
    });
    const steps: EventEnvelope[] = [
      envelope({ eventId: "seed-c-1", correlation: { goldPipelineRunId: goldRunId }, stage: "GOLD_PRODUCT_BUILD", status: "RUNNING", occurredAt: iso(t1, 0) }),
      envelope({ eventId: "seed-c-2", correlation: { goldPipelineRunId: goldRunId }, stage: "GOLD_PRODUCT_BUILD", status: "SUCCEEDED", occurredAt: iso(t1, 8) }),
      envelope({ eventId: "seed-c-3", correlation: { goldPipelineRunId: goldRunId, publicationId }, stage: "PUBLICATION", status: "RUNNING", occurredAt: iso(t1, 9) }),
      envelope({ eventId: "seed-c-4", correlation: { publicationId, outboundExchangeId: outboundId }, stage: "PUBLICATION", status: "SUCCEEDED", occurredAt: iso(t1, 13) }),
      envelope({ eventId: "seed-c-5", correlation: { outboundExchangeId: outboundId }, stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED", occurredAt: iso(t1, 13) }),
    ];
    let executionId: string | null = null;
    for (const step of steps) {
      const result = await ingestParsedEvent(step, shortDeadlineCatalog);
      executionId = result.executionId;
    }
    logger.info({ executionId }, "scenario (c) seeded — expect business_sla_status=PASS, health=HEALTHY, and the scenario (b) alert now RESOLVED");
  }

  logger.info("Seeding tenant-isolation demonstration: tenant-observability-test-b");
  {
    await ingestParsedEvent(
      envelope({ eventId: "seed-iso-b", tenantId: OTHER_TENANT, correlation: { publicationId: "pub-seed-iso-b" }, stage: "PUBLICATION", status: "FAILED", occurredAt: new Date().toISOString() }),
      catalogClient,
    );
    logger.info({ tenant: OTHER_TENANT }, "tenant-isolation fixture seeded");
  }

  logger.info(
    { org: ORG, tenant: TENANT, product: PRODUCT },
    "Demo seed complete. Inspect via GET /internal/v1/operations/data-products/event-performance/{health,executions}, " +
      "/internal/v1/operations/alerts, and GET /v1/customer/data-products/event-performance/status.",
  );

  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "Demo seed failed");
  process.exit(1);
});
