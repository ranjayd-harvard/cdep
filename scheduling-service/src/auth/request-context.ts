import type { Role } from "../config/constants.js";

// Customer-facing identity (/v1/*) — established once per request from the
// validated bearer token only, never from query/path/body (AGENTS.md
// section 46).
export interface TenantContext {
  userId: string;
  organizationId: string;
  activeTenantId: string;
  role: Role;
  roles: Role[];
  authenticationMethod: "oidc" | "dev";
}

// Internal/service-to-service identity (/internal/v1/*) — established from
// the shared static key + actor headers, same convention as
// subscription-service/data-product-catalog-service.
export interface ActorContext {
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    tenantContext?: TenantContext;
    actorContext?: ActorContext;
    correlationId: string;
  }
}
