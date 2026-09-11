import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { declareDependency, isVersionWithinRange, listDependents } from "./dependency.service.js";

export async function dependencyRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/data-products/:productId/dependencies",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products", "dependencies"],
        summary: "Declare that one version of this Data Product depends on a version range of another (spec §25).",
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const body = request.body as {
        dependentVersion: string;
        dependsOnDataProductId: string;
        minVersion: string;
        maxVersion?: string;
      };
      const row = await declareDependency({
        dependentDataProductId: productId,
        dependentVersion: body.dependentVersion,
        dependsOnDataProductId: body.dependsOnDataProductId,
        minVersion: body.minVersion,
        maxVersion: body.maxVersion,
      });
      reply.code(201).send({
        version_dependency_id: row.version_dependency_id,
        dependent_data_product_id: row.dependent_data_product_id,
        dependent_version: row.dependent_version,
        depends_on_data_product_id: row.depends_on_data_product_id,
        min_version: row.min_version,
        max_version: row.max_version,
      });
    },
  );

  app.get(
    "/internal/v1/data-products/:productId/versions/:version/dependents",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "data-products", "dependencies"],
        summary: "List dependent products whose declared range covers this exact version (spec §21 point 5).",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const dependents = await listDependents(productId);
      const matching = dependents.filter((d) => isVersionWithinRange(version, d.min_version, d.max_version));
      reply.code(200).send({
        items: matching.map((d) => ({
          dependent_data_product_id: d.dependent_data_product_id,
          dependent_version: d.dependent_version,
          min_version: d.min_version,
          max_version: d.max_version,
        })),
      });
    },
  );
}
