import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";
import { ROLES, type Role } from "../config/constants.js";
import type { RequestContext } from "./request-context.js";

const DEFAULT_DEV_ACTOR: RequestContext = {
  actorType: "USER",
  actorId: "dev-user",
  role: "PLATFORM_ADMIN",
};

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function isActorType(value: string): value is RequestContext["actorType"] {
  return value === "CI" || value === "SERVICE" || value === "USER" || value === "SYSTEM";
}

// All /internal/v1/* routes (spec §15/§20/§28/§29/§37) are protected by a
// shared static key, same pattern as data-exchange-service's
// requireInternalApiKey. In AUTH_MODE=development, a missing key/actor
// headers fall back to a fixed dev identity so local curl/register-contract
// scripts work without hand-crafting headers every time; this path is
// unreachable in production because env.ts refuses to boot with
// AUTH_MODE=development there.
export function requireInternalAuth(minimumRole?: Role) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const providedKey = request.headers["x-internal-api-key"];

    if (env.AUTH_MODE === "development" && !providedKey) {
      request.requestContext = DEFAULT_DEV_ACTOR;
    } else {
      if (!providedKey || providedKey !== env.INTERNAL_API_TOKEN) {
        throw new AppError("FORBIDDEN", "Missing or invalid internal API key.");
      }

      const actorType = request.headers["x-actor-type"];
      const actorId = request.headers["x-actor-id"];
      const role = request.headers["x-actor-role"];

      if (typeof actorType !== "string" || !isActorType(actorType)) {
        throw new AppError("UNAUTHENTICATED", "Missing or invalid x-actor-type header.");
      }
      if (typeof role !== "string" || !isRole(role)) {
        throw new AppError("UNAUTHENTICATED", "Missing or invalid x-actor-role header.");
      }

      request.requestContext = {
        actorType,
        actorId: typeof actorId === "string" && actorId.length > 0 ? actorId : "unknown",
        role,
      };
    }

    if (minimumRole && request.requestContext.role !== minimumRole && request.requestContext.role !== "PLATFORM_ADMIN") {
      throw new AppError("FORBIDDEN", `This endpoint requires the ${minimumRole} role.`);
    }
  };
}
