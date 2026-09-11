import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { ingestEvent } from "../../application/services/event-ingestion.service.js";
import { catalogClient } from "../../container.js";
import { AppError } from "../../common/errors/app-error.js";

// The spec fixes this exact path (section 8/26) — not under /internal/v1,
// but still internal-key gated (push producers are trusted siblings, not
// customers).
export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/events",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "events"] } },
    async (request, reply) => {
      const result = await ingestEvent(request.body, catalogClient);
      if (result.status === "REJECTED") {
        throw new AppError("VALIDATION_ERROR", "Event envelope failed validation.");
      }
      reply.code(result.status === "DUPLICATE" ? 200 : 202).send({
        status: result.status,
        execution_id: result.executionId,
      });
    },
  );
}
