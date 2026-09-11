import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { getActorContext } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { pool } from "../../database/pool.js";
import { ALERT_SEVERITIES, ALERT_STATES } from "../../config/constants.js";
import { acknowledgeAlert, findAlertById, listAlerts, resolveAlert, suppressAlert } from "../../infrastructure/persistence/alert.repository.js";
import { resolveIncidentIfAllAlertsResolved } from "../../infrastructure/persistence/incident.repository.js";
import { serializeAlert } from "../serializers.js";

export async function internalAlertsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/operations/alerts",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "alerts"] } },
    async (request, reply) => {
      const query = z
        .object({
          organization_id: z.string().optional(),
          tenant_id: z.string().optional(),
          data_product_id: z.string().optional(),
          state: z.enum(ALERT_STATES).optional(),
          severity: z.enum(ALERT_SEVERITIES).optional(),
          limit: z.coerce.number().int().positive().max(500).optional(),
        })
        .parse(request.query);
      const items = await listAlerts(pool, {
        organizationId: query.organization_id,
        tenantId: query.tenant_id,
        dataProductId: query.data_product_id,
        state: query.state,
        severity: query.severity,
        limit: query.limit,
      });
      reply.code(200).send({ items: items.map(serializeAlert) });
    },
  );

  app.post(
    "/internal/v1/operations/alerts/:alertId/ack",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "alerts"] } },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { alertId } = request.params as { alertId: string };
      const alert = await acknowledgeAlert(pool, alertId, actor.actorId);
      if (!alert) throw new AppError("ALERT_NOT_FOUND", `Alert '${alertId}' was not found.`);
      reply.code(200).send(serializeAlert(alert));
    },
  );

  app.post(
    "/internal/v1/operations/alerts/:alertId/resolve",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "alerts"] } },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { alertId } = request.params as { alertId: string };
      const alert = await resolveAlert(pool, alertId, actor.actorId);
      if (!alert) throw new AppError("ALERT_NOT_FOUND", `Alert '${alertId}' was not found.`);
      if (alert.incidentId) await resolveIncidentIfAllAlertsResolved(pool, alert.incidentId);
      reply.code(200).send(serializeAlert(alert));
    },
  );

  app.post(
    "/internal/v1/operations/alerts/:alertId/suppress",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "alerts"] } },
    async (request, reply) => {
      const { alertId } = request.params as { alertId: string };
      const body = z.object({ suppressed_until: z.string().datetime() }).parse(request.body);
      const existing = await findAlertById(pool, alertId);
      if (!existing) throw new AppError("ALERT_NOT_FOUND", `Alert '${alertId}' was not found.`);
      const alert = await suppressAlert(pool, alertId, new Date(body.suppressed_until));
      reply.code(200).send(serializeAlert(alert!));
    },
  );
}
