import { logger } from "../../common/logger/logger.js";
import { env } from "../../config/env.js";
import type { ExecutionReason } from "../../config/constants.js";
import { buildScheduledExecutionKey } from "../../domain/execution-key.js";
import { findLatestDueOccurrence, resolveMissedRun } from "../../domain/missed-run.js";
import type { ScheduleConfig } from "../../domain/schedule.js";
import { getScheduleStrategy } from "../../domain/strategies/index.js";
import { withTransaction } from "../../database/transaction.js";
import { pool } from "../../database/pool.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";
import { claimDueProjections, updateNextRunAt } from "../../infrastructure/persistence/projection.repository.js";
import { insertExecutionIfAbsent } from "../../infrastructure/persistence/execution.repository.js";
import type { Clock } from "../../ports/clock.port.js";

const CLAIM_BATCH_SIZE = 100;

interface PendingWork {
  projectionId: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  occurrenceToRun: Date;
  reason: ExecutionReason;
}

interface SkippedMissedRun {
  projectionId: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  latestMissedOccurrence: Date;
}

// AGENTS.md section 13/34/36-37: finds schedules whose next_run_at is due,
// atomically claims and advances them (short transaction, no network I/O
// while holding row locks), applies the missed-run policy, then creates
// (idempotently) the ScheduledExecution rows for whatever should actually
// run. Never dispatches anything itself — ExecutionRunner does that in a
// separate step against the rows this leaves behind.
export class DueScheduleScanner {
  constructor(private readonly clock: Clock) {}

  async scanOnce(): Promise<{ due: number; created: number; skippedMissed: number }> {
    const now = this.clock.now();
    const toCreate: PendingWork[] = [];
    const toSkip: SkippedMissedRun[] = [];

    await withTransaction(async (client) => {
      const due = await claimDueProjections(client, now, CLAIM_BATCH_SIZE);

      for (const projection of due) {
        const config: ScheduleConfig = {
          mode: projection.scheduleMode,
          timezone: projection.timezone,
          deliveryTimeLocal: projection.deliveryTimeLocal,
          dayOfWeek: projection.dayOfWeek,
          cronExpression: projection.cronExpression,
        };
        const strategy = getScheduleStrategy(projection.scheduleMode);

        let latest: Date | null;
        let newNextRunAt: Date | null;
        try {
          latest = findLatestDueOccurrence(strategy, config, projection.nextRunAt as Date, now);
          newNextRunAt = strategy.calculateNextRun(config, now);
        } catch (err) {
          // Config became invalid since the reconciler last validated it
          // (e.g. an edited-but-not-yet-reconciled cron expression) —
          // freeze next_run_at rather than looping on a broken schedule
          // every tick; the next successful reconcile will repair or
          // permanently clear it.
          logger.error({ err, subscriptionId: projection.subscriptionId }, "Failed to compute next run for due projection; freezing until next reconcile");
          await updateNextRunAt(client, projection.id, null);
          continue;
        }

        await updateNextRunAt(client, projection.id, newNextRunAt);
        if (!latest) continue;

        const resolution = resolveMissedRun(latest, now, env.SCHEDULER_MISSED_RUN_POLICY, env.SCHEDULER_MISSED_RUN_GRACE_MINUTES);
        if (resolution.action === "SKIP" || !resolution.occurrenceToRun) {
          toSkip.push({
            projectionId: projection.id,
            subscriptionId: projection.subscriptionId,
            organizationId: projection.organizationId,
            tenantId: projection.tenantId,
            latestMissedOccurrence: latest,
          });
          continue;
        }

        const occurrenceToRun = resolution.occurrenceToRun;
        const isOnTime = projection.nextRunAt !== null && occurrenceToRun.getTime() === projection.nextRunAt.getTime();
        toCreate.push({
          projectionId: projection.id,
          subscriptionId: projection.subscriptionId,
          organizationId: projection.organizationId,
          tenantId: projection.tenantId,
          dataProductId: projection.dataProductId,
          occurrenceToRun,
          reason: isOnTime ? "SCHEDULED" : "MISSED_RUN_RECOVERY",
        });
      }
    });

    for (const work of toCreate) {
      const executionKey = buildScheduledExecutionKey(work.subscriptionId, work.occurrenceToRun, work.reason as "SCHEDULED" | "MISSED_RUN_RECOVERY");
      const execution = await insertExecutionIfAbsent(pool, {
        executionKey,
        subscriptionId: work.subscriptionId,
        organizationId: work.organizationId,
        tenantId: work.tenantId,
        dataProductId: work.dataProductId,
        reason: work.reason,
        scheduledFor: work.occurrenceToRun,
        requestedVersionPolicyType: null,
        requestedVersionPolicyValue: null,
        maxAttempts: env.SCHEDULER_MAX_ATTEMPTS,
      });
      await recordAuditEvent(pool, {
        eventType: "SCHEDULE_DUE",
        actorType: "SYSTEM",
        actorId: "scheduling-service",
        organizationId: work.organizationId,
        tenantId: work.tenantId,
        subscriptionId: work.subscriptionId,
        executionId: execution.id,
        correlationId: null,
        metadata: { scheduledFor: work.occurrenceToRun.toISOString(), reason: work.reason },
      });
    }

    for (const skipped of toSkip) {
      await recordAuditEvent(pool, {
        eventType: "PUBLICATION_SKIPPED",
        actorType: "SYSTEM",
        actorId: "scheduling-service",
        organizationId: skipped.organizationId,
        tenantId: skipped.tenantId,
        subscriptionId: skipped.subscriptionId,
        executionId: null,
        correlationId: null,
        metadata: { reasonCode: "MISSED_RUN_SKIPPED", latestMissedOccurrence: skipped.latestMissedOccurrence.toISOString() },
      });
    }

    return { due: toCreate.length + toSkip.length, created: toCreate.length, skippedMissed: toSkip.length };
  }
}
