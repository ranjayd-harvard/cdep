import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { getActorContext } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { EXECUTION_REASONS, EXECUTION_STATUSES } from "../../config/constants.js";
import { deadLetterService, manualTriggerService } from "../../container.js";
import { pool } from "../../database/pool.js";
import { findDeadLetterByExecutionId } from "../../infrastructure/persistence/dead-letter.repository.js";
import { findExecutionById, listExecutions } from "../../infrastructure/persistence/execution.repository.js";
import { serializeDeadLetter, serializeExecution } from "../serializers.js";

const executionFilterSchema = z.object({
  status: z.enum(EXECUTION_STATUSES).optional(),
  subscription_id: z.string().optional(),
  organization_id: z.string().optional(),
  tenant_id: z.string().optional(),
  data_product_id: z.string().optional(),
  reason: z.enum(EXECUTION_REASONS).optional(),
  scheduled_from: z.string().datetime().optional(),
  scheduled_to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const triggerBodySchema = z.object({}).passthrough();

const resolveBodySchema = z.object({
  note: z.string().optional(),
});

// Operational APIs (AGENTS.md section 54) — every route here is
// service/operator-only, gated by requireInternalAuth. Filters accept
// organization_id/tenant_id for administrative cross-tenant queries; that
// is safe here specifically because the caller already authenticated as a
// trusted internal actor, unlike the customer-facing routes.
export async function internalSchedulerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/scheduler/executions",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "scheduler"] } },
    async (request, reply) => {
      const query = executionFilterSchema.parse(request.query);
      const page = await listExecutions(pool, {
        status: query.status,
        subscriptionId: query.subscription_id,
        organizationId: query.organization_id,
        tenantId: query.tenant_id,
        dataProductId: query.data_product_id,
        reason: query.reason,
        scheduledFrom: query.scheduled_from ? new Date(query.scheduled_from) : undefined,
        scheduledTo: query.scheduled_to ? new Date(query.scheduled_to) : undefined,
        limit: query.limit,
        offset: query.offset,
      });
      reply.code(200).send({ items: page.items.map(serializeExecution), has_more: page.hasMore });
    },
  );

  app.get(
    "/internal/scheduler/executions/:executionId",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "scheduler"] } },
    async (request, reply) => {
      const { executionId } = request.params as { executionId: string };
      const execution = await findExecutionById(pool, executionId);
      if (!execution) {
        throw new AppError("EXECUTION_NOT_FOUND", `Execution '${executionId}' was not found.`);
      }
      reply.code(200).send(serializeExecution(execution));
    },
  );

  // AGENTS.md section 23: minimal request body — organizationId/tenantId/
  // resolvedProductVersion/storage paths are never accepted from the
  // client, only resolved server-side via ManualTriggerService.
  app.post(
    "/internal/scheduler/subscriptions/:subscriptionId/trigger",
    { preHandler: [requireInternalAuth("SCHEDULER_ADMIN")], schema: { tags: ["internal", "scheduler"] } },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { subscriptionId } = request.params as { subscriptionId: string };
      triggerBodySchema.parse(request.body ?? {});
      const idempotencyKey = (request.headers["idempotency-key"] as string | undefined) ?? null;

      const execution = await manualTriggerService.trigger({
        subscriptionId,
        reason: "MANUAL",
        idempotencyKey,
        actorType: actor.actorType,
        actorId: actor.actorId,
      });
      reply.code(202).send(serializeExecution(execution));
    },
  );

  app.post(
    "/internal/scheduler/executions/:executionId/redrive",
    { preHandler: [requireInternalAuth("SCHEDULER_ADMIN")], schema: { tags: ["internal", "scheduler"] } },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { executionId } = request.params as { executionId: string };
      const deadLetter = await findDeadLetterByExecutionId(pool, executionId);
      if (!deadLetter || deadLetter.resolvedAt) {
        throw new AppError("DEAD_LETTER_NOT_FOUND", `No unresolved dead-letter record found for execution '${executionId}'.`);
      }
      const redriven = await deadLetterService.redrive(deadLetter.id, actor.actorId);
      reply.code(200).send(serializeExecution(redriven));
    },
  );

  app.get(
    "/internal/scheduler/dead-letter",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "scheduler"] } },
    async (request, reply) => {
      const query = z
        .object({
          unresolved_only: z.coerce.boolean().optional(),
          organization_id: z.string().optional(),
          tenant_id: z.string().optional(),
          limit: z.coerce.number().int().positive().max(200).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        })
        .parse(request.query);
      const page = await deadLetterService.list({
        unresolvedOnly: query.unresolved_only,
        organizationId: query.organization_id,
        tenantId: query.tenant_id,
        limit: query.limit,
        offset: query.offset,
      });
      reply.code(200).send({ items: page.items.map(serializeDeadLetter), has_more: page.hasMore });
    },
  );

  app.post(
    "/internal/scheduler/dead-letter/:deadLetterId/resolve",
    { preHandler: [requireInternalAuth("SCHEDULER_ADMIN")], schema: { tags: ["internal", "scheduler"] } },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { deadLetterId } = request.params as { deadLetterId: string };
      const body = resolveBodySchema.parse(request.body ?? {});
      const resolved = await deadLetterService.resolve(deadLetterId, actor.actorId, body.note ?? null);
      reply.code(200).send(serializeDeadLetter(resolved));
    },
  );
}
