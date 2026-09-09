import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../auth/customer-auth.middleware.js";
import { getTenantContext } from "../../auth/authorization.js";
import { withIdempotency } from "../../infrastructure/idempotency/with-idempotency.js";
import {
  activateSubscription,
  cancelSubscription,
  createSubscription,
  getSubscription,
  listSubscriptions,
  pauseSubscription,
  resumeSubscription,
  updateSubscriptionDeliveryPreference,
  updateSubscriptionVersionPolicyCommand,
} from "../../application/services/subscription.service.js";
import { findDeliveryPreferenceBySubscription } from "../../infrastructure/persistence/delivery-preference.repository.js";
import { pool } from "../../database/pool.js";
import { AppError } from "../../common/errors/app-error.js";
import { serializeSubscription } from "../serializers.js";
import type { DeliveryPreferenceInput } from "../../domain/delivery-preference.js";

const versionPolicyBodySchema = z.union([
  z.string(),
  z.object({
    type: z.enum(["EXACT", "COMPATIBLE_MAJOR", "LATEST_ACTIVE"]),
    value: z.string().nullable(),
  }),
]);

const deliveryBodySchema = z.object({
  method: z.enum(["FILE", "API"]),
  format: z.string().optional(),
  frequency: z.enum(["ON_DEMAND", "DAILY", "WEEKLY", "MONTHLY", "CRON"]),
  delivery_time: z.string().optional(),
  timezone: z.string().optional(),
  retention_days: z.number().int().optional(),
  api_profile: z.string().optional(),
  // Phase 7 (scheduling-service AGENTS.md section 19/20): WEEKLY's target
  // day and CRON's expression. Optional at this boundary — the Scheduler
  // enforces they're present before auto-scheduling a WEEKLY/CRON
  // subscription; a subscription missing them simply stays manual-only.
  day_of_week: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]).optional(),
  cron_expression: z.string().optional(),
});

function toDeliveryInput(body: z.infer<typeof deliveryBodySchema>): DeliveryPreferenceInput {
  return {
    method: body.method,
    format: body.format ?? null,
    frequency: body.frequency,
    deliveryTime: body.delivery_time ?? null,
    timezone: body.timezone ?? null,
    retentionDays: body.retention_days ?? null,
    apiProfile: body.api_profile ?? null,
    dayOfWeek: body.day_of_week ?? null,
    cronExpression: body.cron_expression ?? null,
  };
}

const createSubscriptionSchema = z.object({
  data_product_id: z.string().min(1),
  version_policy: versionPolicyBodySchema,
  delivery: deliveryBodySchema,
});

const patchSubscriptionSchema = z.object({
  version_policy: versionPolicyBodySchema.optional(),
  delivery: deliveryBodySchema.optional(),
});

async function loadFullSubscription(organizationId: string, tenantId: string, subscriptionId: string) {
  const { subscription, delivery } = await getSubscription(organizationId, tenantId, subscriptionId);
  return serializeSubscription(subscription, delivery);
}

// Customer-facing (spec §34). Every handler derives organization/tenant
// from the authenticated session only (spec §31) — request params/body
// never supply them.
export async function customerSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/subscriptions",
    {
      preHandler: [requireAuth()],
      schema: { tags: ["subscriptions"], summary: "Create a subscription to an entitled Data Product (spec §37)." },
    },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const body = createSubscriptionSchema.parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

      const result = await withIdempotency(
        { idempotencyKey, organizationId: ctx.organizationId, tenantId: ctx.activeTenantId, operation: "CREATE_SUBSCRIPTION", requestBody: body },
        async () => {
          const { subscription, delivery } = await createSubscription(
            {
              organizationId: ctx.organizationId,
              tenantId: ctx.activeTenantId,
              dataProductId: body.data_product_id,
              versionPolicy: body.version_policy,
              delivery: toDeliveryInput(body.delivery),
            },
            { actorType: "USER", actorId: ctx.userId, correlationId: request.correlationId },
          );
          return { status: 201, body: serializeSubscription(subscription, delivery), resourceId: subscription.subscriptionId };
        },
      );

      reply.code(result.status).send(result.body);
    },
  );

  app.get(
    "/v1/subscriptions",
    { preHandler: [requireAuth()], schema: { tags: ["subscriptions"], summary: "List this tenant's subscriptions." } },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const subscriptions = await listSubscriptions(ctx.organizationId, ctx.activeTenantId);
      const items = await Promise.all(
        subscriptions.map(async (subscription) => {
          const delivery = await findDeliveryPreferenceBySubscription(pool, subscription.subscriptionId);
          return delivery ? serializeSubscription(subscription, delivery) : null;
        }),
      );
      reply.code(200).send({ items: items.filter(Boolean) });
    },
  );

  app.get(
    "/v1/subscriptions/:subscriptionId",
    {
      preHandler: [requireAuth()],
      schema: { tags: ["subscriptions"], params: { type: "object", properties: { subscriptionId: { type: "string" } } } },
    },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const { subscriptionId } = request.params as { subscriptionId: string };
      const body = await loadFullSubscription(ctx.organizationId, ctx.activeTenantId, subscriptionId);
      reply.code(200).send(body);
    },
  );

  app.patch(
    "/v1/subscriptions/:subscriptionId",
    {
      preHandler: [requireAuth()],
      schema: {
        tags: ["subscriptions"],
        summary: "Update version policy and/or delivery preference (spec §34) — explicit lifecycle transitions use dedicated endpoints, not this.",
        params: { type: "object", properties: { subscriptionId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const ctx = getTenantContext(request);
      const { subscriptionId } = request.params as { subscriptionId: string };
      const body = patchSubscriptionSchema.parse(request.body);
      const actor = { actorType: "USER" as const, actorId: ctx.userId, correlationId: request.correlationId };

      if (!body.version_policy && !body.delivery) {
        throw new AppError("VALIDATION_ERROR", "PATCH body must include version_policy and/or delivery.");
      }

      if (body.version_policy) {
        await updateSubscriptionVersionPolicyCommand(
          { organizationId: ctx.organizationId, tenantId: ctx.activeTenantId, subscriptionId, versionPolicy: body.version_policy },
          actor,
        );
      }
      if (body.delivery) {
        await updateSubscriptionDeliveryPreference(
          { organizationId: ctx.organizationId, tenantId: ctx.activeTenantId, subscriptionId, delivery: toDeliveryInput(body.delivery) },
          actor,
        );
      }

      const result = await loadFullSubscription(ctx.organizationId, ctx.activeTenantId, subscriptionId);
      reply.code(200).send(result);
    },
  );

  const lifecycleAction = (
    path: string,
    operation: string,
    action: (organizationId: string, tenantId: string, subscriptionId: string, actor: { actorType: "USER"; actorId: string; correlationId: string }) => Promise<unknown>,
  ) => {
    app.post(
      path,
      {
        preHandler: [requireAuth()],
        schema: { tags: ["subscriptions"], params: { type: "object", properties: { subscriptionId: { type: "string" } } } },
      },
      async (request, reply) => {
        const ctx = getTenantContext(request);
        const { subscriptionId } = request.params as { subscriptionId: string };
        const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

        const result = await withIdempotency(
          { idempotencyKey, organizationId: ctx.organizationId, tenantId: ctx.activeTenantId, operation, requestBody: { subscriptionId } },
          async () => {
            await action(ctx.organizationId, ctx.activeTenantId, subscriptionId, { actorType: "USER", actorId: ctx.userId, correlationId: request.correlationId });
            const body = await loadFullSubscription(ctx.organizationId, ctx.activeTenantId, subscriptionId);
            return { status: 200, body, resourceId: subscriptionId };
          },
        );

        reply.code(result.status).send(result.body);
      },
    );
  };

  lifecycleAction("/v1/subscriptions/:subscriptionId/activate", "ACTIVATE_SUBSCRIPTION", activateSubscription);
  lifecycleAction("/v1/subscriptions/:subscriptionId/pause", "PAUSE_SUBSCRIPTION", pauseSubscription);
  lifecycleAction("/v1/subscriptions/:subscriptionId/resume", "RESUME_SUBSCRIPTION", resumeSubscription);
  lifecycleAction("/v1/subscriptions/:subscriptionId/cancel", "CANCEL_SUBSCRIPTION", (organizationId, tenantId, subscriptionId, actor) =>
    cancelSubscription(organizationId, tenantId, subscriptionId, actor),
  );
}
