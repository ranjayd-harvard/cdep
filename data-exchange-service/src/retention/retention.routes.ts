import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../auth/internal-auth.middleware.js";
import { requestDeletion, setLegalHold } from "./deletion.service.js";
import { listDeletionRequestsForExchange } from "./deletion-request.repository.js";

const requestDeletionBodySchema = z.object({
  reason: z.string().min(1).optional(),
  actorType: z.enum(["CI", "SERVICE", "USER", "SYSTEM"]).default("SYSTEM"),
  actorId: z.string().min(1).default("retention-scheduler"),
});

const legalHoldBodySchema = z.object({
  legalHold: z.boolean(),
  actorType: z.enum(["CI", "SERVICE", "USER", "SYSTEM"]).default("SYSTEM"),
  actorId: z.string().min(1),
});

// Internal-only (spec §24/§25) — same convention as this service's other
// /internal/v1/* surfaces (requireInternalApiKey). No customer ever
// triggers deletion or legal hold directly.
export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/exchanges/:exchangeId/deletion-requests",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal", "retention"],
        summary: "Request deletion of an outbound exchange's artifact (spec §24) — blocked if legal_hold is set.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { exchangeId } = request.params as { exchangeId: string };
      const body = requestDeletionBodySchema.parse(request.body ?? {});
      const result = await requestDeletion(
        exchangeId,
        { actorType: body.actorType, actorId: body.actorId, correlationId: request.correlationId ?? null },
        body.reason,
      );
      reply.code(201).send({
        deletion_request_id: result.deletion_request_id,
        exchange_id: result.exchange_id,
        status: result.status,
        error_message: result.error_message,
        requested_at: result.requested_at,
        completed_at: result.completed_at,
      });
    },
  );

  app.get(
    "/internal/v1/exchanges/:exchangeId/deletion-requests",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal", "retention"],
        summary: "List deletion requests for an exchange (audit/verification).",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { exchangeId } = request.params as { exchangeId: string };
      const items = await listDeletionRequestsForExchange(exchangeId);
      reply.code(200).send({ items });
    },
  );

  app.put(
    "/internal/v1/exchanges/:exchangeId/legal-hold",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal", "retention"],
        summary: "Set or clear legal hold on an exchange (spec §25) — overrides automated retention/deletion while set.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { exchangeId } = request.params as { exchangeId: string };
      const body = legalHoldBodySchema.parse(request.body);
      await setLegalHold(exchangeId, body.legalHold, {
        actorType: body.actorType,
        actorId: body.actorId,
        correlationId: request.correlationId ?? null,
      });
      reply.code(200).send({ exchangeId, legalHold: body.legalHold });
    },
  );
}
