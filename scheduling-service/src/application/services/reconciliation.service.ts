import { logger } from "../../common/logger/logger.js";
import { getScheduleStrategy } from "../../domain/strategies/index.js";
import { pool } from "../../database/pool.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";
import { findProjectionBySubscriptionId, upsertProjection } from "../../infrastructure/persistence/projection.repository.js";
import type { Clock } from "../../ports/clock.port.js";
import type { SchedulableSubscription, SubscriptionClient } from "../../ports/subscription-client.port.js";
import { buildScheduleConfig, isDayOfWeek, scheduleModeForFrequency } from "./schedule-config.js";

const PAGE_SIZE = 200;

// AGENTS.md section 49: periodic pull-based reconciliation rather than a
// cross-service event bus. Subscription Service stays the sole source of
// truth for configuration; this only ever refreshes the scheduler's own
// operational projection from it, keyed by `revision` (the subscription's
// optimistic-concurrency `version`) so an unchanged subscription is not
// recomputed every tick.
export class ReconciliationService {
  constructor(
    private readonly subscriptionClient: SubscriptionClient,
    private readonly clock: Clock,
  ) {}

  async reconcileAll(): Promise<{ reconciled: number }> {
    let offset = 0;
    let reconciled = 0;

    for (;;) {
      const page = await this.subscriptionClient.listSchedulableSubscriptions({ limit: PAGE_SIZE, offset });
      for (const subscription of page.items) {
        await this.reconcileOne(subscription);
        reconciled++;
      }
      if (!page.hasMore || page.items.length === 0) break;
      offset += page.items.length;
    }

    return { reconciled };
  }

  private async reconcileOne(subscription: SchedulableSubscription): Promise<void> {
    const existing = await findProjectionBySubscriptionId(pool, subscription.subscriptionId);
    const mode = scheduleModeForFrequency(subscription.delivery.frequency);
    const wasActive = existing?.subscriptionStatus === "ACTIVE";
    const isActive = subscription.status === "ACTIVE";
    const configChanged = !existing || existing.subscriptionRevision !== subscription.revision;

    let nextRunAt: Date | null;

    if (mode === null || mode === "ON_DEMAND" || !isActive) {
      // Frozen: no automatic due-time while paused/suspended/cancelled, or
      // for a frequency with no ScheduleStrategy yet (AGENTS.md section
      // 43-44 — never accumulate catch-up state while inactive).
      nextRunAt = null;
    } else if (!wasActive || configChanged || !existing?.nextRunAt) {
      // New subscription, just resumed, or schedule config changed: always
      // compute the next occurrence fresh from now — resuming after a
      // pause must never replay everything that would have run while
      // paused (AGENTS.md section 44).
      try {
        const strategy = getScheduleStrategy(mode);
        const config = buildScheduleConfig(mode, subscription.delivery);
        nextRunAt = strategy.calculateNextRun(config, this.clock.now());
      } catch (err) {
        logger.warn({ err, subscriptionId: subscription.subscriptionId }, "Invalid schedule config; subscription remains manual-trigger-only");
        nextRunAt = null;
      }
    } else {
      // Unchanged and already active: preserve the existing next_run_at —
      // DueScheduleScanner owns advancing it once each occurrence fires.
      nextRunAt = existing.nextRunAt;
    }

    await upsertProjection(pool, {
      subscriptionId: subscription.subscriptionId,
      organizationId: subscription.organizationId,
      tenantId: subscription.tenantId,
      dataProductId: subscription.dataProductId,
      subscriptionStatus: subscription.status,
      scheduleMode: mode ?? "ON_DEMAND",
      timezone: subscription.delivery.timezone,
      deliveryTimeLocal: subscription.delivery.deliveryTime,
      dayOfWeek: isDayOfWeek(subscription.delivery.dayOfWeek) ? subscription.delivery.dayOfWeek : null,
      cronExpression: subscription.delivery.cronExpression,
      nextRunAt,
      subscriptionRevision: subscription.revision,
    });

    if (isActive && !wasActive) {
      await recordAuditEvent(pool, {
        eventType: "SCHEDULE_RESUMED",
        actorType: "SYSTEM",
        actorId: "scheduling-service",
        organizationId: subscription.organizationId,
        tenantId: subscription.tenantId,
        subscriptionId: subscription.subscriptionId,
        executionId: null,
        correlationId: null,
        metadata: { nextRunAt: nextRunAt?.toISOString() ?? null },
      });
    } else if (!isActive && wasActive) {
      await recordAuditEvent(pool, {
        eventType: "SCHEDULE_PAUSED",
        actorType: "SYSTEM",
        actorId: "scheduling-service",
        organizationId: subscription.organizationId,
        tenantId: subscription.tenantId,
        subscriptionId: subscription.subscriptionId,
        executionId: null,
        correlationId: null,
        metadata: { subscriptionStatus: subscription.status },
      });
    }
  }
}
