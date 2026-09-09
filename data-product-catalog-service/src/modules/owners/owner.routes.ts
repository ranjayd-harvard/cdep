import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { AppError } from "../../common/errors/app-error.js";
import { createOwner, findOwner, listOwners } from "./owner.repository.js";

export async function ownerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/owners",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "owners"], summary: "List owners." } },
    async (_request, reply) => {
      const owners = await listOwners();
      reply.code(200).send({
        items: owners.map((o) => ({
          ownerId: o.owner_id,
          ownerType: o.owner_type,
          name: o.name,
          email: o.email,
          team: o.team,
          status: o.status,
        })),
      });
    },
  );

  app.post(
    "/internal/v1/owners",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "owners"],
        summary: "Register an Owner (reference data — provisioned ahead of product registration).",
        body: {
          type: "object",
          required: ["ownerId", "ownerType", "name"],
          properties: {
            ownerId: { type: "string" },
            ownerType: { type: "string", enum: ["TEAM", "PERSON", "SYSTEM"] },
            name: { type: "string" },
            email: { type: "string" },
            team: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        ownerId: string;
        ownerType: string;
        name: string;
        email?: string;
        team?: string;
      };
      const existing = await findOwner(body.ownerId);
      if (existing) {
        throw new AppError("CONFLICT", `Owner '${body.ownerId}' already exists.`);
      }
      const owner = await createOwner(body);
      reply.code(201).send({
        ownerId: owner.owner_id,
        ownerType: owner.owner_type,
        name: owner.name,
        email: owner.email,
        team: owner.team,
        status: owner.status,
      });
    },
  );
}
