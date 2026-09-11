import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { getRequestContext } from "../../auth/authorization.js";
import { createMigration, executeMigration, getMigration, listMigrations } from "./migration-plan.service.js";

function serializePlan(m: { migration_id: string; data_product_id: string; from_version: string; to_version: string; compatibility: string; status: string; start_at: Date | null; deadline: Date | null; reason: string | null; created_at: Date; updated_at: Date }) {
  return {
    migration_id: m.migration_id,
    data_product_id: m.data_product_id,
    from_version: m.from_version,
    to_version: m.to_version,
    compatibility: m.compatibility,
    status: m.status,
    start_at: m.start_at,
    deadline: m.deadline,
    reason: m.reason,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

export async function migrationPlanRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/data-products/:productId/migrations",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products", "migrations"],
        summary: "Create a migration plan from the current ACTIVE version to a target version (spec §34-35).",
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const body = request.body as { toVersion: string; startAt?: string; deadline?: string; reason?: string; idempotencyKey?: string };
      const actor = getRequestContext(request);
      const result = await createMigration(
        productId,
        {
          toVersion: body.toVersion,
          startAt: body.startAt ? new Date(body.startAt) : undefined,
          deadline: body.deadline ? new Date(body.deadline) : undefined,
          reason: body.reason,
          idempotencyKey: body.idempotencyKey,
        },
        actor,
      );
      reply.code(result.status).send({ ...serializePlan(result.body.migration), affected_subscriptions: result.body.affectedSubscriptions });
    },
  );

  app.get(
    "/internal/v1/data-products/:productId/migrations",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "data-products", "migrations"],
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const items = await listMigrations(productId);
      reply.code(200).send({ items: items.map(serializePlan) });
    },
  );

  app.get(
    "/internal/v1/data-products/:productId/migrations/:migrationId",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "data-products", "migrations"],
        params: { type: "object", properties: { productId: { type: "string" }, migrationId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { migrationId } = request.params as { migrationId: string };
      const { migration, subscriptions } = await getMigration(migrationId);
      reply.code(200).send({
        ...serializePlan(migration),
        subscriptions: subscriptions.map((s) => ({
          subscription_id: s.subscription_id,
          organization_id: s.organization_id,
          tenant_id: s.tenant_id,
          status: s.status,
          migrated_at: s.migrated_at,
          failure_reason: s.failure_reason,
        })),
      });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/migrations/:migrationId/execute",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products", "migrations"],
        summary: "Execute a migration plan: auto-move NON_BREAKING subscriptions; BREAKING plans require every subscription already moved (spec §35).",
        params: { type: "object", properties: { productId: { type: "string" }, migrationId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { migrationId } = request.params as { migrationId: string };
      const actor = getRequestContext(request);
      const { migration, results } = await executeMigration(migrationId, actor);
      reply.code(200).send({ ...serializePlan(migration), results });
    },
  );
}
