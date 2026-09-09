import { logger } from "../../common/logger/logger.js";
import { env } from "../../config/env.js";
import type { Clock } from "../../ports/clock.port.js";
import type { LeaderElector } from "../../ports/leader-elector.port.js";
import type { DueScheduleScanner } from "./due-schedule-scanner.service.js";
import type { ExecutionRunner } from "./execution-runner.service.js";
import type { ReconciliationService } from "./reconciliation.service.js";

export interface SchedulerStatus {
  enabled: boolean;
  leader: boolean;
  lastScanAt: string | null;
  lastSuccessfulScanAt: string | null;
  lastReconcileAt: string | null;
  nextScanAt: string | null;
}

// Ties leadership, reconciliation, due-schedule scanning, and execution
// running into the periodic loop described in AGENTS.md section 13. Kept
// separate from the interval/timer mechanics (infrastructure/scheduling/
// scheduler-loop.ts) so the actual tick logic is unit-testable without
// real timers.
export class SchedulerCoordinator {
  private lastScanAt: Date | null = null;
  private lastSuccessfulScanAt: Date | null = null;
  private lastReconcileAt: Date | null = null;
  private nextScanAt: Date | null = null;

  constructor(
    private readonly leaderElector: LeaderElector,
    private readonly reconciliationService: ReconciliationService,
    private readonly dueScheduleScanner: DueScheduleScanner,
    private readonly executionRunner: ExecutionRunner,
    private readonly clock: Clock,
  ) {}

  getStatus(): SchedulerStatus {
    return {
      enabled: env.SCHEDULER_ENABLED,
      leader: this.leaderElector.isLeader(),
      lastScanAt: this.lastScanAt?.toISOString() ?? null,
      lastSuccessfulScanAt: this.lastSuccessfulScanAt?.toISOString() ?? null,
      lastReconcileAt: this.lastReconcileAt?.toISOString() ?? null,
      nextScanAt: this.nextScanAt?.toISOString() ?? null,
    };
  }

  // Leadership is re-checked every tick rather than assumed (AGENTS.md
  // section 14) — a non-leader process stays healthy but passive.
  async runScanTick(): Promise<void> {
    this.lastScanAt = this.clock.now();
    this.nextScanAt = new Date(this.lastScanAt.getTime() + env.SCHEDULER_SCAN_INTERVAL_SECONDS * 1000);

    const isLeader = await this.leaderElector.tryAcquire();
    if (!isLeader) {
      logger.debug("scheduler.scan.skipped_not_leader");
      return;
    }

    logger.info("scheduler.scan.started");
    try {
      const dueResult = await this.dueScheduleScanner.scanOnce();
      const runResult = await this.executionRunner.runOnce();
      this.lastSuccessfulScanAt = this.clock.now();
      logger.info({ ...dueResult, ...runResult }, "scheduler.scan.completed");
    } catch (err) {
      logger.error({ err }, "scheduler.scan.failed");
    }
  }

  async runReconcileTick(): Promise<void> {
    // Independently confirms leadership rather than trusting a cached flag
    // from the scan loop — the two loops run on different cadences and
    // neither should assume the other has already run this process
    // lifetime (e.g. on cold start, reconcile's first tick can otherwise
    // fire before the scan loop has ever called tryAcquire()).
    const isLeader = await this.leaderElector.tryAcquire();
    if (!isLeader) return;
    try {
      const result = await this.reconciliationService.reconcileAll();
      this.lastReconcileAt = this.clock.now();
      logger.info(result, "scheduler.reconcile.completed");
    } catch (err) {
      logger.error({ err }, "scheduler.reconcile.failed");
    }
  }
}
