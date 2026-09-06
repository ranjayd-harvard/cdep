import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../auth/internal-auth.middleware.js";
import { parseOrThrow } from "../../common/utils/validate.js";
import {
  completeOutboundPublication,
  createOutboundPublication,
  failOutboundPublication,
} from "./outbound-publication.service.js";
import {
  completeOutboundPublicationSchema,
  createOutboundPublicationSchema,
  exchangeIdParamSchema,
  failOutboundPublicationSchema,
} from "./outbound-publication.schemas.js";

// Internal-only surface for the real Gold -> Publication Service handoff
// (AGENTS.md Phase 4 sections 21-26) -- protected by requireInternalApiKey,
// NOT customer JWT auth. Additive to, and independent of, the pre-existing
// `/internal/v1/publications` fixture-content simulator in
// ../publications/, which cdep's own upload-triggered demo still uses.
export async function outboundPublicationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/outbound-publications",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Prepare an OUTBOUND exchange for a real Gold Data Product artifact and return a signed upload URL.",
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(createOutboundPublicationSchema, request.body);
      const result = await createOutboundPublication(body);
      reply.code(201).send(result);
    },
  );

  app.post(
    "/internal/v1/outbound-publications/:exchangeId/complete",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Verify the uploaded artifact and mark the OUTBOUND exchange READY.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const params = parseOrThrow(exchangeIdParamSchema, request.params);
      const body = parseOrThrow(completeOutboundPublicationSchema, request.body);
      const result = await completeOutboundPublication(params.exchangeId, body);
      reply.code(200).send(result);
    },
  );

  app.post(
    "/internal/v1/outbound-publications/:exchangeId/fail",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Mark an OUTBOUND publication as FAILED (Publication Service could not complete the handoff).",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const params = parseOrThrow(exchangeIdParamSchema, request.params);
      const body = parseOrThrow(failOutboundPublicationSchema, request.body);
      await failOutboundPublication(params.exchangeId, body.reason);
      reply.code(200).send({ exchangeId: params.exchangeId, status: "FAILED" });
    },
  );
}
