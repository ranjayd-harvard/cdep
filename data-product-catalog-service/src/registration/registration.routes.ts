import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../auth/auth.middleware.js";
import { getRequestContext } from "../auth/authorization.js";
import { recordSecurityAuditEvent } from "../audit/audit.repository.js";
import { AppError } from "../common/errors/app-error.js";
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

      let result;
      try {
        result = await registerContract({
          contract: body.contract,
          contractFormat: body.contractFormat,
          source: body.source,
          actor,
        });
      } catch (err) {
        // Phase 11 (spec §20/§29): a rejected registration — including the
        // governance rules in registration.validator.ts (missing piiType/
        // maskingPolicy/retentionPolicyRef on a RESTRICTED field) — is a
        // security/governance-relevant event worth its own audit trail,
        // distinct from registration_events (which only records
        // successful registrations).
        if (err instanceof AppError && err.code === "CONTRACT_INVALID") {
          await recordSecurityAuditEvent({
            eventType: "CONTRACT_POLICY_VIOLATION",
            actorType: actor.actorType,
            actorId: actor.actorId,
            resourceType: "contract",
            resourceId: (body.contract as { metadata?: { id?: string } } | undefined)?.metadata?.id ?? null,
            decision: "DENY",
            reasonCode: "CONTRACT_INVALID",
            correlationId: request.correlationId,
            metadata: { message: err.message },
          });
        }
        throw err;
      }

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
