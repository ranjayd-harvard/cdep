import type { FastifyInstance } from "fastify";
import { checkDatabaseHealth } from "../../database/pool.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", { schema: { tags: ["health"] } }, async (_request, reply) => {
    reply.code(200).send({ status: "ok" });
  });

  // Readiness pings Postgres only — no Catalog Service call (spec §56:
  // "without causing expensive downstream calls").
  app.get("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const dbOk = await checkDatabaseHealth();
    reply.code(dbOk ? 200 : 503).send({
      status: dbOk ? "ok" : "not_ready",
      checks: { database: dbOk ? "ok" : "unavailable" },
    });
  });
}
