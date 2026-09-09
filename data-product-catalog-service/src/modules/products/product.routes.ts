import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCustomerProductDetail, listCustomerProducts } from "./product.service.js";

const listQuerySchema = z.object({
  search: z.string().optional(),
  domain: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export async function productRoutes(app: FastifyInstance): Promise<void> {
  // Customer-facing, read-only (spec §25/§37) — no auth required for Phase
  // 5; entitlement filtering is delegated to ProductVisibilityResolver.
  app.get(
    "/v1/data-products",
    {
      schema: {
        tags: ["data-products"],
        summary: "Search/list discoverable Data Products (spec §25/§39).",
        querystring: {
          type: "object",
          properties: {
            search: { type: "string" },
            domain: { type: "string" },
            status: { type: "string" },
            limit: { type: "number" },
            cursor: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const page = await listCustomerProducts(query);
      reply.code(200).send(page);
    },
  );

  app.get(
    "/v1/data-products/:productId",
    {
      schema: {
        tags: ["data-products"],
        summary: "Get customer-safe Data Product detail (spec §26).",
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const detail = await getCustomerProductDetail(productId);
      reply.code(200).send(detail);
    },
  );
}
