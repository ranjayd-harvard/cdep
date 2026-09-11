import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { getActorContext } from "../../auth/authorization.js";
import { findDeliveryPreferenceBySubscription } from "../../infrastructure/persistence/delivery-preference.repository.js";
import { pool } from "../../database/pool.js";
import {
  getDeliveryContext,
  getDeliveryContextForScope,
  listDeliveryCandidates,
  suspendSubscription,
  updateSubscriptionVersionPolicyCommand,
} from "../../application/services/subscription.service.js";
import { parseVersionPolicy } from "../../domain/version-policy.js";
import { findSubscriptionById } from "../../infrastructure/persistence/subscription.repository.js";
import { serializeDeliveryContext, serializeSubscription } from "../serializers.js";
import { AppError } from "../../common/errors/app-error.js";
import { SUBSCRIPTION_STATUSES, VERSION_POLICY_TYPES } from "../../config/constants.js";

const candidateQuerySchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  data_product_id: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Phase-7-facing (spec §27/§36) — declarative read model only. Never
// computes next_run_at/due-ness; that belongs entirely to Phase 7.
export async function internalSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/subscriptions/delivery-candidates",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "subscriptions"] } },
    async (request, reply) => {
      const query = candidateQuerySchema.parse(request.query);
      const page = await listDeliveryCandidates({
        status: query.status,
        dataProductId: query.data_product_id,
        limit: query.limit,
        offset: query.offset,
      });
      const items = await Promise.all(
        page.items.map(async (subscription) => {
          const delivery = await findDeliveryPreferenceBySubscription(pool, subscription.subscriptionId);
          return delivery ? serializeSubscription(subscription, delivery) : null;
        }),
      );
      reply.code(200).send({ items: items.filter(Boolean), has_more: page.hasMore });
    },
  );

  // Phase-8-facing (data-product-api-service): resolves a subscription from
  // (organization_id, tenant_id, data_product_id) instead of a
  // subscription_id, since the API service authenticates into a tenant
  // context and never learns a subscription_id on its own. Registered
  // before the ":subscriptionId/..." routes purely for readability — the
  // literal "resolve" segment can never collide with a route that expects
  // exactly one more path segment.
  app.get(
    "/internal/v1/subscriptions/resolve",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "subscriptions"] } },
    async (request, reply) => {
      const query = z
        .object({
          organization_id: z.string().min(1).max(64),
          tenant_id: z.string().min(1).max(64),
          data_product_id: z.string().min(1),
        })
        .parse(request.query);
      const dto = await getDeliveryContextForScope(query.organization_id, query.tenant_id, query.data_product_id);
      reply.code(200).send(serializeDeliveryContext(dto));
    },
  );

  app.get(
    "/internal/v1/subscriptions/:subscriptionId/delivery-context",
    {
      preHandler: [requireInternalAuth()],
      schema: { tags: ["internal", "subscriptions"], params: { type: "object", properties: { subscriptionId: { type: "string" } } } },
    },
    async (request, reply) => {
      const { subscriptionId } = request.params as { subscriptionId: string };
      const dto = await getDeliveryContext(subscriptionId);
      reply.code(200).send(serializeDeliveryContext(dto));
    },
  );

  // Provider/platform-controlled suspension (spec §16/§33) — distinct from
  // the automatic entitlement-revocation cascade (entitlement-revocation.service.ts).
  app.post(
    "/internal/v1/subscriptions/:subscriptionId/suspend",
    {
      preHandler: [requireInternalAuth("PLATFORM_ADMIN")],
      schema: { tags: ["internal", "subscriptions"], params: { type: "object", properties: { subscriptionId: { type: "string" } } } },
    },
    async (request, reply) => {
      const actor = { ...getActorContext(request), correlationId: request.correlationId };
      const { subscriptionId } = request.params as { subscriptionId: string };
      const body = z.object({ reason: z.string().min(1) }).parse(request.body);

      const subscription = await findSubscriptionById(pool, subscriptionId);
      if (!subscription) {
        throw new AppError("SUBSCRIPTION_NOT_FOUND", `Subscription '${subscriptionId}' was not found.`);
      }

      const updated = await suspendSubscription(subscription.organizationId, subscription.tenantId, subscriptionId, actor, body.reason);
      const delivery = await findDeliveryPreferenceBySubscription(pool, subscriptionId);
      reply.code(200).send(delivery ? serializeSubscription(updated, delivery) : { subscription_id: updated.subscriptionId, status: updated.status });
    },
  );

  // Phase 10 §35: the one system-driven write path a Catalog migration
  // plan execution uses to move a subscription's version policy — Catalog
  // never writes Subscription's table directly (spec §72), it calls this
  // instead, same discipline as every other cross-service write in this
  // repo. Platform-level (not per-tenant customer action), same
  // authorization bar as /suspend above.
  app.post(
    "/internal/v1/subscriptions/:subscriptionId/version-policy",
    {
      preHandler: [requireInternalAuth("PLATFORM_ADMIN")],
      schema: { tags: ["internal", "subscriptions"], params: { type: "object", properties: { subscriptionId: { type: "string" } } } },
    },
    async (request, reply) => {
      const actor = { ...getActorContext(request), correlationId: request.correlationId };
      const { subscriptionId } = request.params as { subscriptionId: string };
      const body = z
        .object({
          version_policy: z.union([z.string(), z.object({ type: z.enum(VERSION_POLICY_TYPES), value: z.string().nullable() })]),
        })
        .parse(request.body);

      const subscription = await findSubscriptionById(pool, subscriptionId);
      if (!subscription) {
        throw new AppError("SUBSCRIPTION_NOT_FOUND", `Subscription '${subscriptionId}' was not found.`);
      }

      const updated = await updateSubscriptionVersionPolicyCommand(
        {
          organizationId: subscription.organizationId,
          tenantId: subscription.tenantId,
          subscriptionId,
          versionPolicy: parseVersionPolicy(body.version_policy),
        },
        actor,
      );
      const delivery = await findDeliveryPreferenceBySubscription(pool, subscriptionId);
      reply.code(200).send(delivery ? serializeSubscription(updated, delivery) : { subscription_id: updated.subscriptionId });
    },
  );
}
