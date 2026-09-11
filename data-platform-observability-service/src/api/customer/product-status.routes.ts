import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../auth/customer-auth.middleware.js";
import { getTenantContext, requirePermission } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { pool } from "../../database/pool.js";
import { listExecutions } from "../../infrastructure/persistence/execution.repository.js";

// Customer-safe projection (spec section 27) — the ONLY function allowed
// to read from internal tables for this route. Tenant identity always
// comes from the authenticated context (getTenantContext), never a
// client-supplied id/query param (spec section 28). Every failure mode
// (product truly doesn't exist / tenant isn't entitled / wrong tenant)
// collapses to the same 404, matching data-product-api-service's Phase 8
// anti-enumeration discipline — never distinguishing why.
export async function customerProductStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/customer/data-products/:productId/status",
    { preHandler: [requireAuth(), requirePermission("operations.read")], schema: { tags: ["customer"] } },
    async (request, reply) => {
      const tenant = getTenantContext(request);
      const { productId } = request.params as { productId: string };

      const latestPage = await listExecutions(pool, {
        organizationId: tenant.organizationId,
        tenantId: tenant.activeTenantId,
        dataProductId: productId,
        limit: 1,
      });
      const latest = latestPage.items[0];
      if (!latest) {
        throw new AppError("PRODUCT_STATUS_NOT_FOUND", "No operational status is available for this product.");
      }

      const successfulPage = await listExecutions(pool, {
        organizationId: tenant.organizationId,
        tenantId: tenant.activeTenantId,
        dataProductId: productId,
        overallStatus: "SUCCEEDED",
        limit: 1,
      });
      const lastSuccessful = successfulPage.items[0] ?? null;

      const freshnessMinutes =
        lastSuccessful?.completedAt != null ? Math.round((Date.now() - lastSuccessful.completedAt.getTime()) / 60_000) : null;

      reply.code(200).send({
        product: { id: latest.dataProductId, version: latest.productVersion },
        status: latest.healthStatus,
        freshnessMinutes,
        lastSuccessfulDeliveryAt: lastSuccessful?.completedAt ?? null,
        // Next-scheduled-delivery visibility is owned by scheduling-service
        // and not yet wired into this customer-safe projection in this
        // pass — reported honestly as null rather than fabricated.
        nextScheduledDeliveryAt: null,
        sla: { status: latest.businessSlaStatus },
      });
    },
  );
}
