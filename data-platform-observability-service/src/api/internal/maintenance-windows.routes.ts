import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { getActorContext } from "../../auth/authorization.js";
import { pool } from "../../database/pool.js";
import { MAINTENANCE_WINDOW_SCOPES } from "../../config/constants.js";
import { generateMaintenanceWindowId } from "../../common/ids/id-generator.js";
import { createMaintenanceWindow, listMaintenanceWindows } from "../../infrastructure/persistence/maintenance-window.repository.js";
import { serializeMaintenanceWindow } from "../serializers.js";

const createSchema = z.object({
  scope: z.enum(MAINTENANCE_WINDOW_SCOPES),
  scope_value: z.string().nullable().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  reason: z.string().min(1),
});

// Auditable by construction (spec section 23) — created_by always comes
// from the authenticated internal actor's context, never a client-supplied
// field.
export async function internalMaintenanceWindowRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/operations/maintenance-windows",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "maintenance-windows"] } },
    async (request, reply) => {
      const query = z.object({ limit: z.coerce.number().int().positive().max(500).optional() }).parse(request.query);
      const items = await listMaintenanceWindows(pool, query.limit);
      reply.code(200).send({ items: items.map(serializeMaintenanceWindow) });
    },
  );

  app.post(
    "/internal/v1/operations/maintenance-windows",
    { preHandler: [requireInternalAuth("PLATFORM_ADMIN")], schema: { tags: ["internal", "maintenance-windows"] } },
    async (request, reply) => {
      const actor = getActorContext(request);
      const body = createSchema.parse(request.body);
      const window = await createMaintenanceWindow(pool, {
        maintenanceWindowId: generateMaintenanceWindowId(),
        scope: body.scope,
        scopeValue: body.scope_value ?? null,
        startsAt: new Date(body.starts_at),
        endsAt: new Date(body.ends_at),
        reason: body.reason,
        createdBy: actor.actorId,
      });
      reply.code(201).send(serializeMaintenanceWindow(window));
    },
  );
}
