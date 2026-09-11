import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";
import { ROLES, type Role } from "../config/constants.js";
import { verifyServiceToken } from "../security/service-identity.js";
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

// Protects all /internal/v1/* routes (spec §14/§35/§36).
//
// Preferred path (spec §14, service identity): a separate "x-service-token"
// header carries a short-lived HS256 JWT (security/service-identity.ts)
// signed with the same per-relationship secret this service used to
// compare as a raw string — role/actor come from the *verified* token
// payload, not a plaintext x-actor-role header a holder of the key could
// set to anything. This is deliberately a NEW header, not a repurposed
// "x-internal-api-key", so migrating a caller is purely additive: an
// un-migrated callee (or one still running an older build) simply ignores
// a header it doesn't recognize, and nothing breaks mid-rollout.
//
// Legacy path (raw static key in "x-internal-api-key" + plaintext actor
// headers): still accepted when no valid x-service-token is present,
// EXCEPT in production, where it is refused entirely (spec §37, fail
// closed) — production callers must be migrated onto signed tokens.
// In AUTH_MODE=development, a request with neither falls back to a fixed
// dev actor so local curl/scripts/demo work without hand-crafting headers.
export function requireInternalAuth(minimumRole?: Role) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const serviceToken = request.headers["x-service-token"];
    const verified =
      typeof serviceToken === "string"
        ? await verifyServiceToken(env.INTERNAL_API_TOKEN, serviceToken, "subscription-service").catch(() => null)
        : null;

    if (verified) {
      if (!isRole(verified.role)) {
        throw new AppError("UNAUTHENTICATED", `Service token carries an unrecognized role: ${verified.role}`);
      }
      request.actorContext = { actorType: "SERVICE", actorId: verified.sub, role: verified.role };
    } else {
      const providedKey = request.headers["x-internal-api-key"];

      if (env.AUTH_MODE === "development" && !providedKey) {
        request.actorContext = DEFAULT_DEV_ACTOR;
      } else if (env.NODE_ENV === "production") {
        throw new AppError("FORBIDDEN", "Missing or invalid internal service token.");
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
    }

    if (minimumRole && request.actorContext.role !== minimumRole && request.actorContext.role !== "PLATFORM_ADMIN") {
      throw new AppError("FORBIDDEN", `This endpoint requires the ${minimumRole} role.`);
    }
  };
}
