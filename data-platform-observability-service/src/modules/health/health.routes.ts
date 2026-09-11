import type { FastifyInstance } from "fastify";
import { checkDatabaseHealth } from "../../database/pool.js";
import { checkLakehouseHealth } from "../../database/lakehouse-pool.js";
import { latestHealthPerService } from "../../infrastructure/persistence/service-health.repository.js";
import { pool } from "../../database/pool.js";

// Infrastructure/service health (spec section 32) — deliberately distinct
// from Data Product health (operational_executions.health_status,
// GET /internal/v1/operations/data-products/:productId/health). An
// unavailable Observability Service is never confused with a failed Data
// Product: this endpoint set only ever answers "is this service and its
// direct dependencies reachable".
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", { schema: { tags: ["health"] } }, async (_request, reply) => {
    reply.code(200).send({ status: "ok" });
  });

  app.get("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const [dbOk, lakehouseOk] = await Promise.all([checkDatabaseHealth(), checkLakehouseHealth()]);
    const siblingHealth = await latestHealthPerService(pool);

    reply.code(dbOk ? 200 : 503).send({
      status: dbOk ? "ok" : "not_ready",
      checks: {
        database: dbOk ? "ok" : "unavailable",
        lakehouseMetadataDatabase: lakehouseOk ? "ok" : "unavailable",
      },
      siblingServices: siblingHealth,
    });
  });
}
