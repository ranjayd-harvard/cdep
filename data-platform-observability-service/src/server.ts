import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./common/logger/logger.js";
import { pollersAndReconciliation } from "./container.js";

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info({ port: env.PORT, authMode: env.AUTH_MODE }, "data-platform-observability-service listening");
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }

  pollersAndReconciliation.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    await pollersAndReconciliation.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
