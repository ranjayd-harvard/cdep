import type { FastifyInstance } from "fastify";
import { checkDatabaseHealth } from "../../database/pool.js";
import { schedulerCoordinator } from "../../container.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", { schema: { tags: ["health"] } }, async (_request, reply) => {
    // Never fails merely because a dependency (Catalog/Subscription/
    // Publication) had a transient blip (AGENTS.md section 55).
    reply.code(200).send({ status: "ok" });
  });

  app.get("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const dbOk = await checkDatabaseHealth();
    reply.code(dbOk ? 200 : 503).send({
      status: dbOk ? "ok" : "not_ready",
      checks: { database: dbOk ? "ok" : "unavailable" },
    });
  });

  // Leadership state is diagnostic, not a health determinant (AGENTS.md
  // section 55) — a healthy, non-leader replica is expected and normal.
  app.get("/internal/scheduler/status", { schema: { tags: ["internal", "scheduler"] } }, async (_request, reply) => {
    reply.code(200).send({ healthy: true, ...schedulerCoordinator.getStatus() });
  });
}
