import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { AppError } from "../../common/errors/app-error.js";
import { pool } from "../../database/pool.js";
import { INCIDENT_STATES } from "../../config/constants.js";
import { findIncidentById, listIncidents } from "../../infrastructure/persistence/incident.repository.js";
import { listAlerts } from "../../infrastructure/persistence/alert.repository.js";
import { serializeAlert, serializeIncident } from "../serializers.js";

export async function internalIncidentsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/operations/incidents",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "incidents"] } },
    async (request, reply) => {
      const query = z
        .object({ tenant_id: z.string().optional(), data_product_id: z.string().optional(), state: z.enum(INCIDENT_STATES).optional() })
        .parse(request.query);
      const items = await listIncidents(pool, { tenantId: query.tenant_id, dataProductId: query.data_product_id, state: query.state });
      reply.code(200).send({ items: items.map(serializeIncident) });
    },
  );

  app.get(
    "/internal/v1/operations/incidents/:incidentId",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "incidents"] } },
    async (request, reply) => {
      const { incidentId } = request.params as { incidentId: string };
      const incident = await findIncidentById(pool, incidentId);
      if (!incident) throw new AppError("INCIDENT_NOT_FOUND", `Incident '${incidentId}' was not found.`);
      const alerts = await listAlerts(pool, { tenantId: incident.tenantId, dataProductId: incident.dataProductId });
      reply.code(200).send({
        ...serializeIncident(incident),
        alerts: alerts.filter((a) => a.incidentId === incidentId).map(serializeAlert),
      });
    },
  );
}
