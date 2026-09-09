import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../auth/auth.middleware.js";
import { getRequestContext } from "../auth/authorization.js";
import { registerContract } from "./registration.service.js";

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/contracts/register",
    {
      preHandler: [requireInternalAuth("CONTRACT_REGISTRAR")],
      schema: {
        tags: ["internal", "contracts"],
        summary: "Register a normalized Contract-as-Code document (Contract → Catalog Registration, spec §15).",
        body: {
          type: "object",
          required: ["contract"],
          properties: {
            contract: { type: "object" },
            contractFormat: { type: "string", enum: ["YAML", "JSON"] },
            source: {
              type: "object",
              properties: {
                repository: { type: "string" },
                path: { type: "string" },
                commit: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        contract: unknown;
        contractFormat?: "YAML" | "JSON";
        source?: { repository?: string; path?: string; commit?: string };
      };
      const actor = getRequestContext(request);

      const result = await registerContract({
        contract: body.contract,
        contractFormat: body.contractFormat,
        source: body.source,
        actor,
      });

      request.log.info(
        {
          dataProductId: result.dataProductId,
          version: result.version,
          contractId: result.contractId,
          contractHash: result.contractHash,
          compatibility: result.compatibility,
          correlationId: request.correlationId,
        },
        "Contract registration processed",
      );

      reply.code(result.registration === "SUCCESS" ? 201 : 200).send({
        dataProductId: result.dataProductId,
        version: result.version,
        dataProductVersionId: result.dataProductVersionId,
        contractId: result.contractId,
        contractHash: result.contractHash,
        compatibility: result.compatibility,
        compatibilityChanges: result.compatibilityChanges,
        registration: result.registration,
      });
    },
  );
}
