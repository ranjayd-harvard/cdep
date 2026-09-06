import type { FastifyInstance } from "fastify";
import { checkDatabaseHealth } from "../../database/pool.js";
import { env } from "../../config/env.js";

async function checkStorageHealth(): Promise<boolean> {
  try {
    const res = await fetch(new URL("/minio/health/live", env.OBJECT_STORAGE_ENDPOINT), { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", { schema: { tags: ["health"] } }, async (_request, reply) => {
    reply.code(200).send({ status: "ok" });
  });

  app.get("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const [dbOk, storageOk] = await Promise.all([checkDatabaseHealth(), checkStorageHealth()]);
    const ready = dbOk && storageOk;
    reply.code(ready ? 200 : 503).send({
      status: ready ? "ok" : "not_ready",
      checks: { database: dbOk ? "ok" : "unavailable", objectStorage: storageOk ? "ok" : "unavailable" },
    });
  });
}
