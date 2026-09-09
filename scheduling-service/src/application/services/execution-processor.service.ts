import { DependencyError } from "../../common/errors/dependency-error.js";
import { generateCorrelationId } from "../../common/ids/id-generator.js";
import { logger } from "../../common/logger/logger.js";
import type { FailureCategory, IneligibilityReasonCode, SchedulerAuditEventType } from "../../config/constants.js";
import { isLifecyclePublishable } from "../../domain/lifecycle-policy.js";
import { calculateBackoffSeconds, isRetriableFailure, type BackoffConfig } from "../../domain/retry-policy.js";
import type { ScheduledExecution } from "../../domain/execution.js";
import { withTransaction } from "../../database/transaction.js";
import { pool } from "../../database/pool.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";
import { insertDeadLetter } from "../../infrastructure/persistence/dead-letter.repository.js";
import {
  markDeadLettered,
  markDispatching,
  markEligible,
  markRetryWait,
  markSkipped,
  markSucceeded,
  markTerminalFailed,
} from "../../infrastructure/persistence/execution.repository.js";
import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { Clock } from "../../ports/clock.port.js";
import type { EntitlementClient } from "../../ports/entitlement-client.port.js";
import type { PublicationClient } from "../../ports/publication-client.port.js";
import type { SubscriptionClient, SubscriptionDeliveryContext } from "../../ports/subscription-client.port.js";

export interface ExecutionProcessorDeps {
  subscriptionClient: SubscriptionClient;
  entitlementClient: EntitlementClient;
  catalogClient: CatalogClient;
  publicationClient: PublicationClient;
  clock: Clock;
  backoffConfig: BackoffConfig;
}

// The core evaluation + dispatch pipeline (AGENTS.md sections 25-33) —
// runs identically for a fresh PENDING execution and for a retried
// RETRY_WAIT one (a retry always fully re-revalidates rather than
// resuming mid-pipeline, since subscription/entitlement/catalog state may
// have changed between attempts). Every step is audited so an operator can
// reconstruct exactly why an occurrence did or did not publish.
export class ExecutionProcessor {
  constructor(private readonly deps: ExecutionProcessorDeps) {}

  async process(execution: ScheduledExecution): Promise<void> {
    const correlationId = generateCorrelationId();
    await this.audit("SCHEDULE_EVALUATION_STARTED", execution, correlationId, {});

    try {
      await this.run(execution, correlationId);
    } catch (err) {
      // Anything unexpected (a bug, a DB hiccup outside the repository's
      // own error handling) is treated as a transient internal failure
      // rather than silently losing the execution.
      logger.error({ err, executionId: execution.id }, "Unexpected error while processing execution");
      await this.failOrRetry(execution, "INTERNAL_FAILURE", null, (err as Error).message, correlationId);
    }
  }

  private async run(execution: ScheduledExecution, correlationId: string): Promise<void> {
    const { subscriptionClient, entitlementClient, catalogClient } = this.deps;

    // 1. Subscription revalidation — never trust the scheduler projection
    // or a previous execution's result (AGENTS.md section 25).
    let context;
    try {
      context = await subscriptionClient.getDeliveryContext(execution.subscriptionId);
    } catch (err) {
      return this.handleDependencyFailure(execution, err, correlationId);
    }
    await this.audit("SUBSCRIPTION_REVALIDATED", execution, correlationId, {
      found: Boolean(context),
      status: context?.status ?? null,
    });

    if (!context) {
      return this.skip(execution, "SUBSCRIPTION_NOT_FOUND", `Subscription '${execution.subscriptionId}' no longer exists.`, correlationId);
    }
    if (context.status !== "ACTIVE") {
      return this.skip(execution, "SUBSCRIPTION_NOT_ACTIVE", `Subscription status is ${context.status}, not ACTIVE.`, correlationId);
    }

    // 2. Entitlement revalidation, immediately before dispatch (AGENTS.md
    // section 26) — always fresh, never cached.
    let entitlement;
    try {
      entitlement = await entitlementClient.evaluate(execution.organizationId, execution.tenantId, execution.dataProductId);
    } catch (err) {
      return this.handleDependencyFailure(execution, err, correlationId);
    }
    await this.audit("ENTITLEMENT_REVALIDATED", execution, correlationId, {
      decision: entitlement.decision,
      reason: entitlement.reason,
    });
    if (entitlement.decision !== "ALLOW") {
      return this.skip(execution, "ENTITLEMENT_DENIED", `Entitlement decision: ${entitlement.decision} (${entitlement.reason}).`, correlationId);
    }

    // 3. Product-version resolution (AGENTS.md section 27) — distinguish
    // "product doesn't exist" from "no compatible version" for a precise
    // reason code.
    let product;
    try {
      product = await catalogClient.getProduct(execution.dataProductId);
    } catch (err) {
      return this.handleDependencyFailure(execution, err, correlationId);
    }
    if (!product) {
      return this.skip(execution, "PRODUCT_NOT_FOUND", `Data product '${execution.dataProductId}' was not found in the Catalog.`, correlationId);
    }

    let resolved;
    try {
      resolved = await catalogClient.resolveVersionPolicy(execution.dataProductId, {
        type: context.versionPolicy.type as "EXACT" | "COMPATIBLE_MAJOR" | "LATEST_ACTIVE",
        value: context.versionPolicy.value,
      });
    } catch (err) {
      return this.handleDependencyFailure(execution, err, correlationId);
    }
    if (!resolved) {
      return this.skip(
        execution,
        "NO_COMPATIBLE_VERSION",
        `No version of '${execution.dataProductId}' satisfies policy ${context.versionPolicy.type}:${context.versionPolicy.value ?? ""}.`,
        correlationId,
      );
    }
    await this.audit("VERSION_RESOLVED", execution, correlationId, { resolvedVersion: resolved.version, lifecycleStatus: resolved.lifecycleStatus });

    // 4. Lifecycle eligibility (AGENTS.md section 28).
    if (!isLifecyclePublishable(resolved.lifecycleStatus, context.versionPolicy.type)) {
      return this.skip(
        execution,
        "PRODUCT_VERSION_NOT_PUBLISHABLE",
        `Version ${resolved.version} has lifecycle status ${resolved.lifecycleStatus}, not publishable under policy ${context.versionPolicy.type}.`,
        correlationId,
      );
    }

    // 5. Delivery capability (AGENTS.md section 29).
    let capability;
    try {
      capability = await catalogClient.validateDeliveryCapability(execution.dataProductId, resolved.version, context.delivery.method, context.delivery.format);
    } catch (err) {
      return this.handleDependencyFailure(execution, err, correlationId);
    }
    if (!capability.supported) {
      return this.skip(
        execution,
        capability.reason ?? "DELIVERY_METHOD_UNSUPPORTED",
        `Data product '${execution.dataProductId}' version ${resolved.version} does not support ${context.delivery.method}${
          context.delivery.format ? `/${context.delivery.format}` : ""
        } delivery.`,
        correlationId,
      );
    }

    // Eligible.
    await withTransaction((client) =>
      markEligible(client, execution.id, {
        resolvedProductVersion: resolved.version,
        deliveryMethod: context.delivery.method as "FILE" | "API",
        format: context.delivery.format,
      }),
    );
    await this.audit("PUBLICATION_ELIGIBLE", execution, correlationId, { resolvedVersion: resolved.version });

    await this.dispatch(execution, context, resolved.version, correlationId);
  }

  private async dispatch(
    execution: ScheduledExecution,
    context: SubscriptionDeliveryContext,
    resolvedVersion: string,
    correlationId: string,
  ): Promise<void> {
    // The Scheduler's own deterministic execution_key IS the cross-service
    // idempotency key handed to Publication Service (AGENTS.md section 33)
    // — identical across every retry attempt of this same logical
    // execution, so a lost-response retry can never create a second
    // artifact.
    await withTransaction((client) => markDispatching(client, execution.id, execution.executionKey));
    await this.audit("PUBLICATION_REQUEST_CREATED", execution, correlationId, {
      resolvedVersion,
      deliveryMethod: context.delivery.method,
      format: context.delivery.format,
    });

    let outcome;
    try {
      outcome = await this.deps.publicationClient.trigger({
        organizationId: execution.organizationId,
        tenantId: execution.tenantId,
        dataProductId: execution.dataProductId,
        productVersion: resolvedVersion,
        format: context.delivery.format,
        externalIdempotencyKey: execution.executionKey,
      });
    } catch (err) {
      await this.audit("PUBLICATION_REQUEST_FAILED", execution, correlationId, { error: (err as Error).message });
      return this.handleDependencyFailure(execution, err, correlationId);
    }

    if (outcome.status === "READY" || outcome.status === "SKIPPED_DUPLICATE") {
      await withTransaction((client) => markSucceeded(client, execution.id, outcome.publicationId));
      await this.audit("PUBLICATION_REQUEST_SUBMITTED", execution, correlationId, {
        publicationId: outcome.publicationId,
        status: outcome.status,
        outboundExchangeId: outcome.outboundExchangeId,
      });
      return;
    }

    // outcome.status === "FAILED" — Publication Service ran but the
    // publication itself failed. Classify by error_code: quality/format/
    // contract problems are permanent configuration failures; anything
    // else defaults to transient (AGENTS.md section 63 — Gold reads,
    // exports, and the Exchange Service handoff can all fail transiently).
    const permanentCodes = new Set(["UNSUPPORTED_FORMAT", "QUALITY_GATE_FAILED", "CONTRACT_VALIDATION_FAILED", "SCHEMA_PROJECTION_FAILED", "CROSS_TENANT_SAFETY_FAILED"]);
    const category: FailureCategory = permanentCodes.has(outcome.errorCode ?? "") ? "PUBLICATION_REJECTED" : "TRANSIENT_DEPENDENCY_FAILURE";
    await this.audit("PUBLICATION_REQUEST_FAILED", execution, correlationId, { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage });
    await this.failOrRetry(execution, category, outcome.errorCode, outcome.errorMessage ?? "Publication Service reported FAILED.", correlationId);
  }

  private async handleDependencyFailure(execution: ScheduledExecution, err: unknown, correlationId: string): Promise<void> {
    const retriable = err instanceof DependencyError ? err.retriable : true;
    const category: FailureCategory = retriable ? "TRANSIENT_DEPENDENCY_FAILURE" : "PERMANENT_CONFIGURATION_FAILURE";
    const code = err instanceof DependencyError ? err.service : null;
    await this.failOrRetry(execution, category, code, (err as Error).message, correlationId);
  }

  private async skip(execution: ScheduledExecution, reasonCode: IneligibilityReasonCode, message: string, correlationId: string): Promise<void> {
    await withTransaction((client) => markSkipped(client, execution.id, reasonCode, message));
    await this.audit("PUBLICATION_SKIPPED", execution, correlationId, { reasonCode, message });
  }

  private async failOrRetry(execution: ScheduledExecution, category: FailureCategory, code: string | null, message: string, correlationId: string): Promise<void> {
    const retriable = isRetriableFailure(category) && execution.attemptCount < execution.maxAttempts;

    if (retriable) {
      const backoffSeconds = calculateBackoffSeconds(execution.attemptCount, this.deps.backoffConfig);
      const nextRetryAt = new Date(this.deps.clock.now().getTime() + backoffSeconds * 1000);
      await withTransaction((client) => markRetryWait(client, execution.id, { failureCategory: category, failureCode: code, failureMessage: message, nextRetryAt }));
      await this.audit("PUBLICATION_RETRY_SCHEDULED", execution, correlationId, { failureCategory: category, attemptCount: execution.attemptCount, nextRetryAt: nextRetryAt.toISOString() });
      return;
    }

    await withTransaction((client) => markTerminalFailed(client, execution.id, { failureCategory: category, failureCode: code, failureMessage: message }));
    await this.audit("PUBLICATION_TERMINAL_FAILURE", execution, correlationId, { failureCategory: category, attemptCount: execution.attemptCount });

    await withTransaction(async (client) => {
      await markDeadLettered(client, execution.id);
      await insertDeadLetter(client, {
        executionId: execution.id,
        subscriptionId: execution.subscriptionId,
        organizationId: execution.organizationId,
        tenantId: execution.tenantId,
        failureCategory: category,
        failureCode: code,
        failureMessage: message,
        attemptCount: execution.attemptCount,
        payloadSnapshot: {
          executionKey: execution.executionKey,
          dataProductId: execution.dataProductId,
          scheduledFor: execution.scheduledFor.toISOString(),
          reason: execution.reason,
        },
      });
    });
    await this.audit("EXECUTION_DEAD_LETTERED", execution, correlationId, { failureCategory: category });
  }

  private async audit(
    eventType: SchedulerAuditEventType,
    execution: ScheduledExecution,
    correlationId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await recordAuditEvent(pool, {
      eventType,
      actorType: "SYSTEM",
      actorId: "scheduling-service",
      organizationId: execution.organizationId,
      tenantId: execution.tenantId,
      subscriptionId: execution.subscriptionId,
      executionId: execution.id,
      correlationId,
      metadata,
    });
  }
}
