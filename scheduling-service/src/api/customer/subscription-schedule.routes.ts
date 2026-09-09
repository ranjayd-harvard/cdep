import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../auth/customer-auth.middleware.js";
import { getTenantContext } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { EXECUTION_STATUSES } from "../../config/constants.js";
import { manualTriggerService, subscriptionClient } from "../../container.js";
import { pool } from "../../database/pool.js";
import { findExecutionById, listExecutions } from "../../infrastructure/persistence/execution.repository.js";
import { findProjectionBySubscriptionId } from "../../infrastructure/persistence/projection.repository.js";
import { serializeExecution } from "../serializers.js";

const executionListQuerySchema = z.object({
  status: z.enum(EXECUTION_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Customer-facing read/trigger APIs (AGENTS.md section 24/53). Every
// handler derives organization/tenant from the authenticated session only
// — subscriptionId path params are used to filter, never to establish
// authorization. A subscription belonging to a different tenant returns
// the same 404 a genuinely nonexistent one would (AGENTS.md section
// 45/46), whether that's enforced by an explicit ownership check
// (schedule-status, which needs a live Subscription Service call anyway)
// or, for the DB-only execution reads, simply by scoping every query to
// (organization_id, tenant_id) from the authenticated context.
export async function customerSubscriptionScheduleRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/subscriptions/:subscriptionId/schedule-status",
    { preHandler: [requireAuth()], schema: { tags: ["subscriptions", "scheduler"] } },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const { subscriptionId } = request.params as { subscriptionId: string };

      const context = await subscriptionClient.getDeliveryContext(subscriptionId);
      if (!context || context.organizationId !== ctx.organizationId || context.tenantId !== ctx.activeTenantId) {
        throw new AppError("SUBSCRIPTION_NOT_FOUND", `Subscription '${subscriptionId}' was not found.`);
      }

      const projection = await findProjectionBySubscriptionId(pool, subscriptionId);
      const lastPage = await listExecutions(pool, {
        subscriptionId,
        organizationId: ctx.organizationId,
        tenantId: ctx.activeTenantId,
        limit: 1,
      });
      const last = lastPage.items[0] ?? null;

      reply.code(200).send({
        subscription_id: subscriptionId,
        status: context.status,
        schedule_mode: projection?.scheduleMode ?? null,
        time_zone: context.delivery.timezone,
        next_scheduled_run: projection?.nextRunAt ?? null,
        last_execution: last
          ? { execution_id: last.id, scheduled_for: last.scheduledFor, status: last.status }
          : null,
      });
    },
  );

  app.get(
    "/v1/subscriptions/:subscriptionId/executions",
    { preHandler: [requireAuth()], schema: { tags: ["subscriptions", "scheduler"] } },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const { subscriptionId } = request.params as { subscriptionId: string };
      const query = executionListQuerySchema.parse(request.query);

      const page = await listExecutions(pool, {
        subscriptionId,
        organizationId: ctx.organizationId,
        tenantId: ctx.activeTenantId,
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      });
      reply.code(200).send({ items: page.items.map(serializeExecution), has_more: page.hasMore });
    },
  );

  app.get(
    "/v1/subscriptions/:subscriptionId/executions/:executionId",
    { preHandler: [requireAuth()], schema: { tags: ["subscriptions", "scheduler"] } },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const { subscriptionId, executionId } = request.params as { subscriptionId: string; executionId: string };

      const execution = await findExecutionById(pool, executionId);
      if (
        !execution ||
        execution.subscriptionId !== subscriptionId ||
        execution.organizationId !== ctx.organizationId ||
        execution.tenantId !== ctx.activeTenantId
      ) {
        throw new AppError("EXECUTION_NOT_FOUND", `Execution '${executionId}' was not found.`);
      }
      reply.code(200).send(serializeExecution(execution));
    },
  );

  // AGENTS.md section 24: customer-triggered on-demand publication. Never
  // exposes the unrestricted internal scheduler trigger — this always
  // routes through ManualTriggerService with requireOwnership set, so a
  // subscription belonging to another tenant is rejected exactly like a
  // nonexistent one.
  app.post(
    "/v1/subscriptions/:subscriptionId/publications",
    { preHandler: [requireAuth()], schema: { tags: ["subscriptions", "scheduler"] } },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const { subscriptionId } = request.params as { subscriptionId: string };
      const idempotencyKey = (request.headers["idempotency-key"] as string | undefined) ?? null;

      const execution = await manualTriggerService.trigger({
        subscriptionId,
        reason: "ON_DEMAND",
        idempotencyKey,
        actorType: "USER",
        actorId: ctx.userId,
        requireOwnership: { organizationId: ctx.organizationId, tenantId: ctx.activeTenantId },
      });
      reply.code(202).send(serializeExecution(execution));
    },
  );
}
