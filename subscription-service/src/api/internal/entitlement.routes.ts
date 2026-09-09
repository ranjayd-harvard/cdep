import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { getActorContext } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { withIdempotency } from "../../infrastructure/idempotency/with-idempotency.js";
import {
  allowEntitlement,
  denyEntitlement,
  evaluateEntitlementDecision,
  getEntitlement,
  grantEntitlement,
  updateEntitlement,
} from "../../application/services/entitlement.service.js";
import { pool } from "../../database/pool.js";
import { serializeEntitlement, serializeEntitlementDecision } from "../serializers.js";

const grantSchema = z.object({
  organization_id: z.string().min(1).max(64),
  tenant_id: z.string().min(1).max(64),
  data_product_id: z.string().min(1),
  effect: z.enum(["ALLOW", "DENY"]),
  valid_from: z.string().datetime().nullable().optional(),
  valid_until: z.string().datetime().nullable().optional(),
  reason: z.string().nullable().optional(),
});

const updateSchema = z.object({
  version: z.number().int(),
  valid_from: z.string().datetime().nullable().optional(),
  valid_until: z.string().datetime().nullable().optional(),
  reason: z.string().nullable().optional(),
});

const evaluateSchema = z.object({
  organization_id: z.string().min(1).max(64),
  tenant_id: z.string().min(1).max(64),
  data_product_id: z.string().min(1),
  evaluation_time: z.string().datetime().optional(),
});

// Admin/internal only (spec §33/§35) — grant/deny is never exposed to
// ordinary tenant users. requireInternalAuth("ENTITLEMENT_ADMIN") allows
// that role or PLATFORM_ADMIN through.
export async function internalEntitlementRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/entitlements",
    { preHandler: [requireInternalAuth("ENTITLEMENT_ADMIN")], schema: { tags: ["internal", "entitlements"] } },
    async (request, reply) => {
      const actor = { ...getActorContext(request), correlationId: request.correlationId };
      const body = grantSchema.parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

      const result = await withIdempotency(
        { idempotencyKey, organizationId: body.organization_id, tenantId: body.tenant_id, operation: "GRANT_ENTITLEMENT", requestBody: body },
        async () => {
          const entitlement = await grantEntitlement(
            {
              organizationId: body.organization_id,
              tenantId: body.tenant_id,
              dataProductId: body.data_product_id,
              effect: body.effect,
              validFrom: body.valid_from ? new Date(body.valid_from) : null,
              validUntil: body.valid_until ? new Date(body.valid_until) : null,
              reason: body.reason ?? null,
            },
            actor,
          );
          return { status: 201, body: serializeEntitlement(entitlement), resourceId: entitlement.entitlementId };
        },
      );

      reply.code(result.status).send(result.body);
    },
  );

  app.get(
    "/internal/v1/entitlements/:entitlementId",
    {
      preHandler: [requireInternalAuth()],
      schema: { tags: ["internal", "entitlements"], params: { type: "object", properties: { entitlementId: { type: "string" } } } },
    },
    async (request, reply) => {
      const { entitlementId } = request.params as { entitlementId: string };
      const entitlement = await getEntitlement(entitlementId);
      if (!entitlement) {
        throw new AppError("ENTITLEMENT_NOT_FOUND", `Entitlement '${entitlementId}' does not exist.`);
      }
      reply.code(200).send(serializeEntitlement(entitlement));
    },
  );

  app.put(
    "/internal/v1/entitlements/:entitlementId",
    {
      preHandler: [requireInternalAuth("ENTITLEMENT_ADMIN")],
      schema: { tags: ["internal", "entitlements"], params: { type: "object", properties: { entitlementId: { type: "string" } } } },
    },
    async (request, reply) => {
      const actor = { ...getActorContext(request), correlationId: request.correlationId };
      const { entitlementId } = request.params as { entitlementId: string };
      const body = updateSchema.parse(request.body);
      const updated = await updateEntitlement(
        {
          entitlementId,
          expectedVersion: body.version,
          validFrom: body.valid_from === undefined ? undefined : body.valid_from ? new Date(body.valid_from) : null,
          validUntil: body.valid_until === undefined ? undefined : body.valid_until ? new Date(body.valid_until) : null,
          reason: body.reason,
        },
        actor,
      );
      reply.code(200).send(serializeEntitlement(updated));
    },
  );

  app.post(
    "/internal/v1/entitlements/:entitlementId/allow",
    {
      preHandler: [requireInternalAuth("ENTITLEMENT_ADMIN")],
      schema: { tags: ["internal", "entitlements"], params: { type: "object", properties: { entitlementId: { type: "string" } } } },
    },
    async (request, reply) => {
      const actor = { ...getActorContext(request), correlationId: request.correlationId };
      const { entitlementId } = request.params as { entitlementId: string };
      const updated = await allowEntitlement(entitlementId, actor);
      reply.code(200).send(serializeEntitlement(updated));
    },
  );

  app.post(
    "/internal/v1/entitlements/:entitlementId/deny",
    {
      preHandler: [requireInternalAuth("ENTITLEMENT_ADMIN")],
      schema: { tags: ["internal", "entitlements"], params: { type: "object", properties: { entitlementId: { type: "string" } } } },
    },
    async (request, reply) => {
      const actor = { ...getActorContext(request), correlationId: request.correlationId };
      const { entitlementId } = request.params as { entitlementId: string };
      const updated = await denyEntitlement(entitlementId, actor);
      reply.code(200).send(serializeEntitlement(updated));
    },
  );

  app.post(
    "/internal/v1/entitlements/evaluate",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "entitlements"] } },
    async (request, reply) => {
      const body = evaluateSchema.parse(request.body);
      const decision = await evaluateEntitlementDecision(
        pool,
        body.organization_id,
        body.tenant_id,
        body.data_product_id,
        body.evaluation_time ? new Date(body.evaluation_time) : new Date(),
      );
      reply.code(200).send(serializeEntitlementDecision(decision));
    },
  );
}
