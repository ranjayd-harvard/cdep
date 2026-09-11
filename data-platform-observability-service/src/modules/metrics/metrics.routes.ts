import type { FastifyInstance } from "fastify";
import { renderPrometheusText } from "../../telemetry/metrics-registry.js";

// Hand-rolled Prometheus-text /metrics (spec section 31, kept light per the
// 9.9 scoping decision) — low-cardinality counters only.
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/metrics", { schema: { tags: ["telemetry"] } }, async (_request, reply) => {
    reply.header("Content-Type", "text/plain; version=0.0.4").code(200).send(renderPrometheusText());
  });
}
