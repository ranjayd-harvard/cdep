import type { FastifyInstance } from "fastify";
import { getRequestContext, requirePermission } from "../../auth/authorization.js";
import { requireAuth } from "../../auth/auth.middleware.js";
import { parseOrThrow } from "../../common/utils/validate.js";
import { completeUpload, initiateUpload } from "./upload.service.js";
import { completeUploadParamsSchema, initiateUploadSchema } from "./upload.schemas.js";

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/uploads",
    {
      preHandler: [requireAuth(), requirePermission("upload")],
      schema: {
        tags: ["uploads"],
        summary: "Initialize an inbound upload exchange and receive a signed upload URL.",
        headers: {
          type: "object",
          properties: { "idempotency-key": { type: "string" } },
        },
        body: {
          type: "object",
          required: ["dataProductId", "filename", "contentType", "sizeBytes"],
          properties: {
            dataProductId: { type: "string" },
            filename: { type: "string" },
            contentType: { type: "string" },
            sizeBytes: { type: "number" },
            schemaVersion: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              exchangeId: { type: "string" },
              status: { type: "string" },
              upload: {
                type: "object",
                properties: {
                  method: { type: "string" },
                  url: { type: "string" },
                  expiresInSeconds: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = getRequestContext(request);
      const body = parseOrThrow(initiateUploadSchema, request.body);
      const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

      const result = await initiateUpload(ctx, body, {
        idempotencyKey,
        correlationId: request.correlationId,
      });
      reply.code(200).send(result);
    },
  );

  app.post(
    "/v1/uploads/:exchangeId/complete",
    {
      preHandler: [requireAuth(), requirePermission("upload")],
      schema: {
        tags: ["uploads"],
        summary: "Finalize an inbound upload after the client has PUT the file to the signed URL.",
        params: {
          type: "object",
          properties: { exchangeId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: { exchangeId: { type: "string" }, status: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = getRequestContext(request);
      const params = parseOrThrow(completeUploadParamsSchema, request.params);
      const result = await completeUpload(ctx, params.exchangeId);
      reply.code(200).send(result);
    },
  );
}
