import { logger } from "../../common/logger/logger.js";
import { env } from "../../config/env.js";
import type { SchedulerCoordinator } from "../../application/services/scheduler-coordinator.service.js";
import type { LeaderElector } from "../../ports/leader-elector.port.js";

// Local-development polling loop (AGENTS.md section 13) — no publication
// depends on exact alignment between ticks, so a plain setInterval is
// sufficient; the LeaderElector/claim/execution-key layers are what make
// this correct even with multiple instances or an irregular tick cadence.
export class SchedulerLoop {
  private scanTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly coordinator: SchedulerCoordinator,
    private readonly leaderElector: LeaderElector,
  ) {}

  start(): void {
    if (!env.SCHEDULER_ENABLED) {
      logger.info("Scheduler loop disabled (SCHEDULER_ENABLED=false)");
      return;
    }
    if (this.running) return;
    this.running = true;

    const runScan = () => {
      void this.coordinator.runScanTick();
    };
    const runReconcile = () => {
      void this.coordinator.runReconcileTick();
    };

    // Fire once immediately on boot rather than waiting a full interval.
    runReconcile();
    runScan();

    this.reconcileTimer = setInterval(runReconcile, env.SCHEDULER_RECONCILE_INTERVAL_SECONDS * 1000);
    this.scanTimer = setInterval(runScan, env.SCHEDULER_SCAN_INTERVAL_SECONDS * 1000);
    logger.info(
      { scanIntervalSeconds: env.SCHEDULER_SCAN_INTERVAL_SECONDS, reconcileIntervalSeconds: env.SCHEDULER_RECONCILE_INTERVAL_SECONDS },
      "Scheduler loop started",
    );
  }

  async stop(): Promise<void> {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.scanTimer = null;
    this.reconcileTimer = null;
    this.running = false;
    await this.leaderElector.release();
  }
}
