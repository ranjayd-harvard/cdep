import { randomUUID } from "node:crypto";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { buildManualExecutionKey } from "../../domain/execution-key.js";
import type { ScheduledExecution } from "../../domain/execution.js";
import { withTransaction } from "../../database/transaction.js";
import { pool } from "../../database/pool.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";
import { claimSpecificExecution, findExecutionById, insertExecutionIfAbsent } from "../../infrastructure/persistence/execution.repository.js";
import type { Clock } from "../../ports/clock.port.js";
import type { SubscriptionClient } from "../../ports/subscription-client.port.js";
import type { ExecutionProcessor } from "./execution-processor.service.js";

export interface ManualTriggerInput {
  subscriptionId: string;
  reason: "MANUAL" | "ON_DEMAND";
  idempotencyKey: string | null;
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string;
  // Present only for the customer-facing path — the trusted org/tenant
  // from the authenticated session, checked against the subscription's
  // actual ownership (AGENTS.md section 23-24: never trust a client-
  // supplied organizationId/tenantId).
  requireOwnership?: { organizationId: string; tenantId: string };
}

// Backs both the internal operator trigger and the customer-facing
// on-demand publication endpoint (AGENTS.md section 22-24). Both routes
// through the exact same policy pipeline as a scheduled occurrence — no
// bypass straight to Publication Service. Runs the execution inline
// (rather than waiting for the next scan tick) so the caller gets a
// synchronous result, while staying race-safe against a concurrent
// background claim via claimSpecificExecution's atomic single-row UPDATE.
export class ManualTriggerService {
  constructor(
    private readonly subscriptionClient: SubscriptionClient,
    private readonly clock: Clock,
    private readonly processor: ExecutionProcessor,
  ) {}

  async trigger(input: ManualTriggerInput): Promise<ScheduledExecution> {
    const context = await this.subscriptionClient.getDeliveryContext(input.subscriptionId);
    if (!context) {
      throw new AppError("SUBSCRIPTION_NOT_FOUND", `Subscription '${input.subscriptionId}' was not found.`);
    }
    if (input.requireOwnership) {
      if (context.organizationId !== input.requireOwnership.organizationId || context.tenantId !== input.requireOwnership.tenantId) {
        // Same "not found" shape a genuinely missing subscription gets —
        // existence must never leak across tenants.
        throw new AppError("SUBSCRIPTION_NOT_FOUND", `Subscription '${input.subscriptionId}' was not found.`);
      }
    }

    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const executionKey = buildManualExecutionKey(input.subscriptionId, input.reason, idempotencyKey);

    const execution = await insertExecutionIfAbsent(pool, {
      executionKey,
      subscriptionId: context.subscriptionId,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      dataProductId: context.dataProductId,
      reason: input.reason,
      scheduledFor: this.clock.now(),
      requestedVersionPolicyType: context.versionPolicy.type,
      requestedVersionPolicyValue: context.versionPolicy.value,
      maxAttempts: env.SCHEDULER_MAX_ATTEMPTS,
    });

    await recordAuditEvent(pool, {
      eventType: "MANUAL_TRIGGER_REQUESTED",
      actorType: input.actorType,
      actorId: input.actorId,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      subscriptionId: context.subscriptionId,
      executionId: execution.id,
      correlationId: null,
      metadata: { reason: input.reason },
    });

    const claimed = await withTransaction((client) => claimSpecificExecution(client, execution.id, this.clock.now()));
    if (claimed) {
      await this.processor.process(claimed);
      const updated = await findExecutionById(pool, execution.id);
      return updated ?? claimed;
    }

    // Lost the claim race to a concurrent background tick (or this is a
    // replayed idempotency key for an execution already past PENDING) —
    // return the execution's current state rather than double-processing.
    return execution;
  }
}
