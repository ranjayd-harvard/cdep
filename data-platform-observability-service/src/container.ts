// Composition root — the one place concrete infrastructure implementations
// are wired to the ports application services depend on. Swapping an HTTP
// client for a different implementation, or the leader elector for a
// distributed lease, touches only this file.
import { systemClock } from "./ports/clock.port.js";
import { ExchangeHttpClient } from "./infrastructure/http/exchange-http-client.js";
import { CatalogHttpClient } from "./infrastructure/http/catalog-http-client.js";
import { SubscriptionHttpClient } from "./infrastructure/http/subscription-http-client.js";
import { SchedulingHttpClient } from "./infrastructure/http/scheduling-http-client.js";
import { PublicationHttpClient } from "./infrastructure/http/publication-http-client.js";
import { ServingProjectionHttpClient } from "./infrastructure/http/serving-projection-http-client.js";
import { PostgresAdvisoryLockLeaderElector } from "./infrastructure/scheduling/postgres-leader-elector.js";
import { createExchangePoller } from "./application/pollers/exchange-poller.js";
import { createPublicationPoller } from "./application/pollers/publication-poller.js";
import { createSchedulingPoller } from "./application/pollers/scheduling-poller.js";
import { createLakehousePoller } from "./application/pollers/lakehouse-poller.js";
import { createServingProjectionPoller } from "./application/pollers/serving-projection-poller.js";
import { createCatalogSlaPoller } from "./application/pollers/catalog-sla-poller.js";
import { runReconciliationPass } from "./application/reconciliation/reconciliation.service.js";
import { env } from "./config/env.js";
import { logger } from "./common/logger/logger.js";

const clock = systemClock;

export const exchangeClient = new ExchangeHttpClient();
export const catalogClient = new CatalogHttpClient();
export const subscriptionClient = new SubscriptionHttpClient();
export const schedulingClient = new SchedulingHttpClient();
export const publicationClient = new PublicationHttpClient();
export const servingProjectionClient = new ServingProjectionHttpClient();

const reconciliationLeaderElector = new PostgresAdvisoryLockLeaderElector();

const pollers = [
  createExchangePoller(exchangeClient, catalogClient),
  createPublicationPoller(publicationClient, catalogClient),
  createSchedulingPoller(schedulingClient, catalogClient, clock),
  createLakehousePoller(catalogClient, clock),
  createServingProjectionPoller(servingProjectionClient),
  createCatalogSlaPoller(catalogClient, clock),
];

let reconcileTimer: NodeJS.Timeout | null = null;

export const pollersAndReconciliation = {
  start(): void {
    if (!env.POLL_ENABLED) {
      logger.info("Pollers disabled (POLL_ENABLED=false)");
      return;
    }
    for (const poller of pollers) poller.start();

    const runReconcile = async () => {
      const acquired = await reconciliationLeaderElector.tryAcquire();
      if (!acquired) return;
      try {
        await runReconciliationPass(
          { exchangeClient, publicationClient, catalogClient, clock },
          Math.max(1, env.RECONCILE_INTERVAL_SECONDS / 3600),
        );
      } catch (err) {
        logger.error({ err }, "reconciliation pass failed");
      }
    };
    void runReconcile();
    reconcileTimer = setInterval(() => void runReconcile(), env.RECONCILE_INTERVAL_SECONDS * 1000);

    logger.info({ pollerCount: pollers.length }, "Pollers and reconciliation loop started");
  },

  async stop(): Promise<void> {
    for (const poller of pollers) poller.stop();
    if (reconcileTimer) clearInterval(reconcileTimer);
    reconcileTimer = null;
    await reconciliationLeaderElector.release();
  },
};
