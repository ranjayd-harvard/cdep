import type { FastifyInstance } from "fastify";
import { getRequestContext, requirePermission } from "../../auth/authorization.js";
import { requireAuth } from "../../auth/auth.middleware.js";
import { parseOrThrow } from "../../common/utils/validate.js";
import { requestDownloadUrl } from "./download.service.js";
import { downloadUrlParamsSchema } from "./download.schemas.js";

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/downloads/:exchangeId/url",
    {
      preHandler: [requireAuth(), requirePermission("download")],
      schema: {
        tags: ["downloads"],
        summary: "Request a short-lived signed download URL for a READY outbound exchange.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
        response: {
          200: {
            type: "object",
            properties: {
              exchangeId: { type: "string" },
              filename: { type: "string" },
              downloadUrl: { type: "string" },
              expiresInSeconds: { type: "number" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = getRequestContext(request);
      const params = parseOrThrow(downloadUrlParamsSchema, request.params);
      const result = await requestDownloadUrl(ctx, params.exchangeId);
      reply.code(200).send(result);
    },
  );
}
