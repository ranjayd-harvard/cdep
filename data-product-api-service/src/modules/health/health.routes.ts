import type { FastifyInstance } from "fastify";
import { checkDatabaseHealth } from "../../database/pool.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", { schema: { tags: ["health"] } }, async (_request, reply) => {
    reply.code(200).send({ status: "ok" });
  });

  // Readiness pings the serving store only — no Catalog/Subscription calls,
  // to avoid an expensive downstream fan-out on every load-balancer probe.
  app.get("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const dbOk = await checkDatabaseHealth();
    reply.code(dbOk ? 200 : 503).send({
      status: dbOk ? "ok" : "not_ready",
      checks: { servingStore: dbOk ? "ok" : "unavailable" },
    });
  });
}
