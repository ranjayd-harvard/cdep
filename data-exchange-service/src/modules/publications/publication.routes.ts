import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../auth/internal-auth.middleware.js";
import { parseOrThrow } from "../../common/utils/validate.js";
import { publishOutboundExchange } from "./publication.service.js";
import { createPublicationSchema } from "./publication.schemas.js";

// Internal-only surface — protected by requireInternalApiKey, NOT customer
// JWT auth. Simulates the future Gold -> Outbound Exchange publication
// hand-off (AGENTS.md section 37/58); no real lakehouse is involved.
export async function publicationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/publications",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Simulate a future Gold publication landing in the outbound exchange zone.",
        body: {
          type: "object",
          required: ["organizationId", "tenantId", "dataProductId", "filename"],
          properties: {
            organizationId: { type: "string" },
            tenantId: { type: "string" },
            dataProductId: { type: "string" },
            schemaVersion: { type: "string" },
            sourceObject: { type: "string" },
            filename: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(createPublicationSchema, request.body);
      const result = await publishOutboundExchange(body);
      reply.code(201).send(result);
    },
  );
}
