// Composition root: the one place concrete infrastructure implementations
// are wired to the ports application services depend on (AGENTS.md section
// 14/15 — "all service boundaries must remain replaceable through
// interfaces/ports"). Swapping, e.g., PostgresAdvisoryLockLeaderElector for
// a future distributed lease implementation touches only this file.
import { env } from "./config/env.js";
import { systemClock } from "./ports/clock.port.js";
import { CatalogHttpClient } from "./infrastructure/http/catalog-http-client.js";
import { SubscriptionHttpClient } from "./infrastructure/http/subscription-http-client.js";
import { EntitlementHttpClient } from "./infrastructure/http/entitlement-http-client.js";
import { PublicationHttpClient } from "./infrastructure/http/publication-http-client.js";
import { PostgresAdvisoryLockLeaderElector } from "./infrastructure/scheduling/postgres-leader-elector.js";
import { SchedulerLoop } from "./infrastructure/scheduling/scheduler-loop.js";
import { ExecutionProcessor } from "./application/services/execution-processor.service.js";
import { DueScheduleScanner } from "./application/services/due-schedule-scanner.service.js";
import { ExecutionRunner } from "./application/services/execution-runner.service.js";
import { ReconciliationService } from "./application/services/reconciliation.service.js";
import { SchedulerCoordinator } from "./application/services/scheduler-coordinator.service.js";
import { ManualTriggerService } from "./application/services/manual-trigger.service.js";
import { DeadLetterService } from "./application/services/dead-letter.service.js";

const clock = systemClock;

const catalogClient = new CatalogHttpClient();
export const subscriptionClient = new SubscriptionHttpClient();
const entitlementClient = new EntitlementHttpClient();
const publicationClient = new PublicationHttpClient();

const executionProcessor = new ExecutionProcessor({
  subscriptionClient,
  entitlementClient,
  catalogClient,
  publicationClient,
  clock,
  backoffConfig: {
    initialBackoffSeconds: env.SCHEDULER_INITIAL_BACKOFF_SECONDS,
    maxBackoffSeconds: env.SCHEDULER_MAX_BACKOFF_SECONDS,
    multiplier: env.SCHEDULER_BACKOFF_MULTIPLIER,
    jitterRatio: env.SCHEDULER_BACKOFF_JITTER_RATIO,
  },
});

const dueScheduleScanner = new DueScheduleScanner(clock);
const executionRunner = new ExecutionRunner(clock, executionProcessor);
const reconciliationService = new ReconciliationService(subscriptionClient, clock);
// Exported so one-shot scripts (scripts/demo.ts) can release its dedicated
// advisory-lock connection before exiting — otherwise that open connection
// keeps the process alive indefinitely even after all other work is done.
// server.ts doesn't need this directly: schedulerLoop.stop() already
// releases it as part of graceful shutdown.
export const leaderElector = new PostgresAdvisoryLockLeaderElector();

export const schedulerCoordinator = new SchedulerCoordinator(leaderElector, reconciliationService, dueScheduleScanner, executionRunner, clock);
export const schedulerLoop = new SchedulerLoop(schedulerCoordinator, leaderElector);
export const manualTriggerService = new ManualTriggerService(subscriptionClient, clock, executionProcessor);
export const deadLetterService = new DeadLetterService();
