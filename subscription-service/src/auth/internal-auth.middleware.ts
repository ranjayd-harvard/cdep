import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";
import { ROLES, type Role } from "../config/constants.js";
import type { ActorContext } from "./request-context.js";

const DEFAULT_DEV_ACTOR: ActorContext = {
  actorType: "USER",
  actorId: "dev-user",
  role: "PLATFORM_ADMIN",
};

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function isActorType(value: string): value is ActorContext["actorType"] {
  return value === "CI" || value === "SERVICE" || value === "USER" || value === "SYSTEM";
}

// Protects all /internal/v1/* routes (spec §35/§36) — shared static key,
// same convention as data-product-catalog-service's requireInternalAuth.
// In AUTH_MODE=development, a missing key falls back to a fixed dev actor
// so local curl/scripts/demo work without hand-crafting headers.
export function requireInternalAuth(minimumRole?: Role) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const providedKey = request.headers["x-internal-api-key"];

    if (env.AUTH_MODE === "development" && !providedKey) {
      request.actorContext = DEFAULT_DEV_ACTOR;
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

      request.actorContext = {
        actorType,
        actorId: typeof actorId === "string" && actorId.length > 0 ? actorId : "unknown",
        role,
      };
    }

    if (minimumRole && request.actorContext.role !== minimumRole && request.actorContext.role !== "PLATFORM_ADMIN") {
      throw new AppError("FORBIDDEN", `This endpoint requires the ${minimumRole} role.`);
    }
  };
}
