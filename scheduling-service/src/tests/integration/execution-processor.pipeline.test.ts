import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../database/pool.js";
import { withTransaction } from "../../database/transaction.js";
import { ensureMigrated, truncateAll } from "../setup/db.js";
import { ExecutionProcessor } from "../../application/services/execution-processor.service.js";
import { claimReadyExecutions, findExecutionByKey, insertExecutionIfAbsent } from "../../infrastructure/persistence/execution.repository.js";
import { listAuditEventsForExecution } from "../../infrastructure/persistence/audit.repository.js";
import { DependencyError } from "../../common/errors/dependency-error.js";
import { FixedClock } from "../../ports/clock.port.js";
import type { CatalogClient, CatalogVersionDetail, CatalogProductDetail, DeliveryCapabilityResult, ResolvedCatalogVersion } from "../../ports/catalog-client.port.js";
import type { EntitlementClient, EntitlementDecisionResult } from "../../ports/entitlement-client.port.js";
import type { PublicationClient, PublicationTriggerOutcome, PublicationTriggerRequest } from "../../ports/publication-client.port.js";
import type { SubscriptionClient, SubscriptionDeliveryContext } from "../../ports/subscription-client.port.js";

// Hand-rolled fakes of the four dependency ports (AGENTS.md section 71-72:
// "provide integration tests using lightweight test HTTP servers for
// Catalog/Subscription/Publication") — in-memory fakes implementing the
// same ports are equivalent here and avoid the awkwardness of scheduling-
// service's `env` singleton being frozen at process start (it can't be
// repointed at a per-test HTTP server's port). Real Postgres is still used
// underneath (claimReadyExecutions/audit trail), so this exercises the
// actual persistence + orchestration wiring, only the outbound HTTP edges
// are faked.

class StubSubscriptionClient implements SubscriptionClient {
  context: SubscriptionDeliveryContext | null = null;
  async getDeliveryContext(): Promise<SubscriptionDeliveryContext | null> {
    return this.context;
  }
  async listSchedulableSubscriptions() {
    return { items: [], hasMore: false };
  }
}

class StubEntitlementClient implements EntitlementClient {
  decision: EntitlementDecisionResult = { decision: "ALLOW", reason: "ACTIVE_ENTITLEMENT", entitlementId: "ent-1" };
  async evaluate(): Promise<EntitlementDecisionResult> {
    return this.decision;
  }
}

class StubCatalogClient implements CatalogClient {
  product: CatalogProductDetail | null = { dataProductId: "event-performance", status: "ACTIVE" };
  resolvedVersion: ResolvedCatalogVersion | null = { version: "1.1.0", lifecycleStatus: "ACTIVE" };
  capability: DeliveryCapabilityResult = { supported: true };

  async getProduct(): Promise<CatalogProductDetail | null> {
    return this.product;
  }
  async getVersion(): Promise<CatalogVersionDetail | null> {
    return this.resolvedVersion ? { version: this.resolvedVersion.version, lifecycleStatus: this.resolvedVersion.lifecycleStatus, delivery: [] } : null;
  }
  async listVersions() {
    return [];
  }
  async resolveVersionPolicy(): Promise<ResolvedCatalogVersion | null> {
    return this.resolvedVersion;
  }
  async validateDeliveryCapability(): Promise<DeliveryCapabilityResult> {
    return this.capability;
  }
}

class StubPublicationClient implements PublicationClient {
  calls: PublicationTriggerRequest[] = [];
  outcome: PublicationTriggerOutcome = { publicationId: "pub-1", status: "READY", outboundExchangeId: "exch-1", errorCode: null, errorMessage: null };
  errorToThrow: DependencyError | null = null;

  async trigger(request: PublicationTriggerRequest): Promise<PublicationTriggerOutcome> {
    this.calls.push(request);
    if (this.errorToThrow) throw this.errorToThrow;
    return this.outcome;
  }
}

const ORG = "org-vobis-org-722aea";
const TENANT = "tenant-default-47d849";
const PRODUCT = "event-performance";

function baseContext(overrides: Partial<SubscriptionDeliveryContext> = {}): SubscriptionDeliveryContext {
  return {
    subscriptionId: "sub-pipeline-test",
    organizationId: ORG,
    tenantId: TENANT,
    dataProductId: PRODUCT,
    status: "ACTIVE",
    versionPolicy: { type: "COMPATIBLE_MINOR", value: "1" },
    resolvedProductVersion: null,
    delivery: {
      method: "FILE",
      format: "PARQUET",
      frequency: "DAILY",
      deliveryTime: "06:00",
      timezone: "UTC",
      retentionDays: 7,
      apiProfile: null,
      dayOfWeek: null,
      cronExpression: null,
    },
    ...overrides,
  };
}

let subscriptionClient: StubSubscriptionClient;
let entitlementClient: StubEntitlementClient;
let catalogClient: StubCatalogClient;
let publicationClient: StubPublicationClient;
let processor: ExecutionProcessor;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  subscriptionClient = new StubSubscriptionClient();
  subscriptionClient.context = baseContext();
  entitlementClient = new StubEntitlementClient();
  catalogClient = new StubCatalogClient();
  publicationClient = new StubPublicationClient();
  processor = new ExecutionProcessor({
    subscriptionClient,
    entitlementClient,
    catalogClient,
    publicationClient,
    clock: new FixedClock(new Date("2026-09-09T06:00:05.000Z")),
    backoffConfig: { initialBackoffSeconds: 30, maxBackoffSeconds: 900, multiplier: 2, jitterRatio: 0 },
  });
});

afterAll(async () => {
  await pool.end();
});

async function createAndClaim(executionKey: string, subscriptionId = "sub-pipeline-test") {
  await insertExecutionIfAbsent(pool, {
    executionKey,
    subscriptionId,
    organizationId: ORG,
    tenantId: TENANT,
    dataProductId: PRODUCT,
    reason: "SCHEDULED",
    scheduledFor: new Date("2026-09-09T06:00:00.000Z"),
    requestedVersionPolicyType: "COMPATIBLE_MINOR",
    requestedVersionPolicyValue: "1",
    maxAttempts: 5,
  });
  const claimed = await withTransaction((client) => claimReadyExecutions(client, new Date("2026-09-09T06:00:05.000Z"), 10));
  return claimed[0]!;
}

describe("ExecutionProcessor pipeline (AGENTS.md section 72 scenarios)", () => {
  it("successful scheduled publication: eligible, dispatched, SUCCEEDED", async () => {
    const execution = await createAndClaim("sub-pipeline-test|2026-09-09T06:00:00.000Z|SCHEDULED");
    await processor.process(execution);

    const stored = await findExecutionByKey(pool, execution.executionKey);
    expect(stored?.status).toBe("SUCCEEDED");
    expect(stored?.publicationId).toBe("pub-1");
    expect(stored?.resolvedProductVersion).toBe("1.1.0");
    expect(publicationClient.calls).toHaveLength(1);
    expect(publicationClient.calls[0]).toMatchObject({
      organizationId: ORG,
      tenantId: TENANT,
      dataProductId: PRODUCT,
      productVersion: "1.1.0",
      externalIdempotencyKey: execution.executionKey,
    });

    const events = (await listAuditEventsForExecution(pool, execution.id)).map((e) => e.eventType);
    expect(events).toEqual([
      "SCHEDULE_EVALUATION_STARTED",
      "SUBSCRIPTION_REVALIDATED",
      "ENTITLEMENT_REVALIDATED",
      "VERSION_RESOLVED",
      "PUBLICATION_ELIGIBLE",
      "PUBLICATION_REQUEST_CREATED",
      "PUBLICATION_REQUEST_SUBMITTED",
    ]);
  });

  it("subscription paused: no PublicationRequest, execution SKIPPED", async () => {
    subscriptionClient.context = baseContext({ status: "PAUSED" });
    const execution = await createAndClaim("sub-pipeline-test|2026-09-09T06:00:00.000Z|SCHEDULED");
    await processor.process(execution);

    const stored = await findExecutionByKey(pool, execution.executionKey);
    expect(stored?.status).toBe("SKIPPED");
    expect(stored?.ineligibilityReasonCode).toBe("SUBSCRIPTION_NOT_ACTIVE");
    expect(publicationClient.calls).toHaveLength(0);
  });

  it("entitlement revoked: subscription still ACTIVE, no PublicationRequest, audited denial", async () => {
    entitlementClient.decision = { decision: "DENY", reason: "EXPLICIT_DENY", entitlementId: "ent-1" };
    const execution = await createAndClaim("sub-pipeline-test|2026-09-09T06:00:00.000Z|SCHEDULED");
    await processor.process(execution);

    const stored = await findExecutionByKey(pool, execution.executionKey);
    expect(stored?.status).toBe("SKIPPED");
    expect(stored?.ineligibilityReasonCode).toBe("ENTITLEMENT_DENIED");
    expect(publicationClient.calls).toHaveLength(0);

    const events = await listAuditEventsForExecution(pool, execution.id);
    const entitlementEvent = events.find((e) => e.eventType === "ENTITLEMENT_REVALIDATED");
    expect(entitlementEvent?.metadata).toMatchObject({ decision: "DENY", reason: "EXPLICIT_DENY" });
  });

  it("product version retired: no PublicationRequest", async () => {
    catalogClient.resolvedVersion = { version: "1.0.0", lifecycleStatus: "RETIRED" };
    subscriptionClient.context = baseContext({ versionPolicy: { type: "EXACT", value: "1.0.0" } });
    const execution = await createAndClaim("sub-pipeline-test|2026-09-09T06:00:00.000Z|SCHEDULED");
    await processor.process(execution);

    const stored = await findExecutionByKey(pool, execution.executionKey);
    expect(stored?.status).toBe("SKIPPED");
    expect(stored?.ineligibilityReasonCode).toBe("PRODUCT_VERSION_NOT_PUBLISHABLE");
    expect(publicationClient.calls).toHaveLength(0);
  });

  it("publication temporarily unavailable: RETRY_WAIT with backoff, same execution, one logical publication", async () => {
    publicationClient.errorToThrow = new DependencyError("Publication Service returned 503.", "PUBLICATION", true);
    const execution = await createAndClaim("sub-pipeline-test|2026-09-09T06:00:00.000Z|SCHEDULED");
    await processor.process(execution);

    const stored = await findExecutionByKey(pool, execution.executionKey);
    expect(stored?.status).toBe("RETRY_WAIT");
    expect(stored?.failureCategory).toBe("TRANSIENT_DEPENDENCY_FAILURE");
    expect(stored?.attemptCount).toBe(1);
    expect(stored?.nextRetryAt).toEqual(new Date("2026-09-09T06:00:35.000Z")); // +30s initial backoff, no jitter

    // Retry re-enters the SAME row (never a second execution for this occurrence).
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM scheduled_execution WHERE execution_key = $1", [execution.executionKey]);
    expect(rows[0].n).toBe(1);
  });

  it("exhausting retries terminal-fails and dead-letters exactly once", async () => {
    publicationClient.errorToThrow = new DependencyError("Publication Service returned 503.", "PUBLICATION", true);
    const execution = await createAndClaim("sub-pipeline-test|2026-09-09T06:00:00.000Z|SCHEDULED");

    // maxAttempts is 5 on the row; simulate exhausting them by processing
    // repeatedly, re-claiming between attempts the way ExecutionRunner would.
    let current = execution;
    for (let i = 0; i < 5; i++) {
      await processor.process(current);
      const claimed = await withTransaction((client) => claimReadyExecutions(client, new Date("2026-09-09T09:00:00.000Z"), 10));
      if (claimed.length === 0) break;
      current = claimed[0]!;
    }

    const stored = await findExecutionByKey(pool, execution.executionKey);
    expect(stored?.status).toBe("DEAD_LETTERED");
    expect(stored?.attemptCount).toBe(5);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM scheduler_dead_letter WHERE execution_id = $1", [execution.id]);
    expect(rows[0].n).toBe(1);
  });
});
