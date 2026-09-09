import type { Role } from "../config/constants.js";

// Established for every authenticated internal request from the
// x-internal-api-key + x-actor-* headers only. Used for authorization
// (authorization.ts) and audit trails (registration_events.actor_type/id).
export interface RequestContext {
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    requestContext?: RequestContext;
    correlationId: string;
  }
}
