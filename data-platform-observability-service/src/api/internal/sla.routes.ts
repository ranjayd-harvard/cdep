import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { pool } from "../../database/pool.js";
import { SLA_STATUSES } from "../../config/constants.js";
import { listEvaluations } from "../../infrastructure/persistence/sla-evaluation.repository.js";
import { serializeSlaEvaluation } from "../serializers.js";

export async function internalSlaRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/operations/sla",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "sla"] } },
    async (request, reply) => {
      const query = z
        .object({
          tenant_id: z.string().optional(),
          data_product_id: z.string().optional(),
          product_version: z.string().optional(),
          status: z.enum(SLA_STATUSES).optional(),
          only_active_breaches: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().positive().max(500).optional(),
        })
        .parse(request.query);
      const items = await listEvaluations(pool, {
        tenantId: query.tenant_id,
        dataProductId: query.data_product_id,
        productVersion: query.product_version,
        status: query.status,
        onlyActiveBreaches: query.only_active_breaches,
        limit: query.limit,
      });
      reply.code(200).send({ items: items.map(serializeSlaEvaluation) });
    },
  );
}
