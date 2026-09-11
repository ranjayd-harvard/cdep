import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { resolveVersion, type VersionPolicy, type ResolutionIntent } from "./resolver.js";

// Phase 10 §30: the single HTTP-facing entry point into the shared
// resolver — every sibling service (subscription-service,
// scheduling-service, data-product-api-service) calls this rather than
// re-implementing version ranking. CATALOG_READER is the lowest internal
// role, deliberately, since this is read-only and called by every sibling.
export async function resolverRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/data-products/:productId/resolve-version",
    {
      preHandler: [requireInternalAuth("CATALOG_READER")],
      schema: {
        tags: ["internal", "data-products", "version-resolution"],
        summary: "Resolve a subscription's version policy to an exact, consumable Data Product version (spec §27-30).",
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const body = request.body as {
        policy: VersionPolicy;
        intent: ResolutionIntent;
        organizationId?: string;
        tenantId?: string;
        preferredVersion?: string;
      };
      const resolved = await resolveVersion(productId, body.policy, body.intent, {
        optedInTenant: body.organizationId && body.tenantId ? { organizationId: body.organizationId, tenantId: body.tenantId } : undefined,
        preferredVersion: body.preferredVersion,
      });
      reply.code(200).send({
        data_product_id: productId,
        resolved_version: resolved.version,
        lifecycle_status: resolved.lifecycleStatus,
        fell_back_to_deprecated: resolved.fellBackToDeprecated,
      });
    },
  );
}
