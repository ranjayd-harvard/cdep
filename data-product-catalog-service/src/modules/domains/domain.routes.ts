import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { AppError } from "../../common/errors/app-error.js";
import { createDomain, findDomain, listDomains } from "./domain.repository.js";

export async function domainRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/domains",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "domains"], summary: "List domains." } },
    async (_request, reply) => {
      const domains = await listDomains();
      reply.code(200).send({
        items: domains.map((d) => ({
          domainId: d.domain_id,
          name: d.name,
          displayName: d.display_name,
          description: d.description,
          status: d.status,
        })),
      });
    },
  );

  app.post(
    "/internal/v1/domains",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "domains"],
        summary: "Register a Domain (reference data — provisioned ahead of product registration).",
        body: {
          type: "object",
          required: ["domainId", "name", "displayName"],
          properties: {
            domainId: { type: "string" },
            name: { type: "string" },
            displayName: { type: "string" },
            description: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { domainId: string; name: string; displayName: string; description?: string };
      const existing = await findDomain(body.domainId);
      if (existing) {
        throw new AppError("CONFLICT", `Domain '${body.domainId}' already exists.`);
      }
      const domain = await createDomain(body);
      reply.code(201).send({
        domainId: domain.domain_id,
        name: domain.name,
        displayName: domain.display_name,
        description: domain.description,
        status: domain.status,
      });
    },
  );
}
