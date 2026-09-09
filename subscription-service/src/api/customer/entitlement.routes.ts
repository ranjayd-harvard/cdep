import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../auth/customer-auth.middleware.js";
import { getTenantContext } from "../../auth/authorization.js";
import { evaluateEntitlementDecision } from "../../application/services/entitlement.service.js";
import { listEntitlementsForTenant } from "../../infrastructure/persistence/entitlement.repository.js";
import { pool } from "../../database/pool.js";
import { serializeEntitlementDecision } from "../serializers.js";

// Customer-facing (spec §34) — returns evaluated decisions only, never the
// admin-only fields (created_by/reason/version) on the raw entitlement row.
export async function customerEntitlementRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/entitlements",
    {
      preHandler: [requireAuth()],
      schema: { tags: ["entitlements"], summary: "List this tenant's current entitlement decisions (spec §34)." },
    },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const rows = await listEntitlementsForTenant(pool, ctx.organizationId, ctx.activeTenantId);
      const decisions = await Promise.all(
        rows.map((row) => evaluateEntitlementDecision(pool, ctx.organizationId, ctx.activeTenantId, row.dataProductId)),
      );
      reply.code(200).send({ items: decisions.map(serializeEntitlementDecision) });
    },
  );

  app.get(
    "/v1/entitlements/products/:dataProductId",
    {
      preHandler: [requireAuth()],
      schema: {
        tags: ["entitlements"],
        summary: "Evaluate this tenant's entitlement decision for one Data Product (spec §14/§34).",
        params: { type: "object", properties: { dataProductId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const { dataProductId } = request.params as { dataProductId: string };
      const decision = await evaluateEntitlementDecision(pool, ctx.organizationId, ctx.activeTenantId, dataProductId);
      reply.code(200).send(serializeEntitlementDecision(decision));
    },
  );
}
