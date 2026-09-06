import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../auth/auth.middleware.js";
import { listDataProducts } from "./data-product.service.js";

export async function dataProductRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/data-products",
    {
      preHandler: [requireAuth()],
      schema: { tags: ["data-products"], summary: "List active data products." },
    },
    async (_request, reply) => {
      const items = await listDataProducts();
      reply.code(200).send({
        items: items.map((p) => ({
          dataProductId: p.data_product_id,
          name: p.name,
          description: p.description,
          direction: p.direction,
          currentSchemaVersion: p.current_schema_version,
        })),
      });
    },
  );
}
