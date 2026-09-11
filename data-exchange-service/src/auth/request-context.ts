import type { Role } from "../config/constants.js";

// Established once per authenticated request, from the validated token
// only. Never populated from query params, path params, form fields, or
// request bodies — see AGENTS.md section 4.
export interface RequestContext {
  userId: string;
  organizationId: string;
  activeTenantId: string;
  // Primary role — kept for backward compatibility with existing
  // role-equality checks. Always equal to roles[0].
  role: Role;
  roles: Role[];
  authenticationMethod: "oidc" | "dev";
}

declare module "fastify" {
  interface FastifyRequest {
    requestContext?: RequestContext;
    correlationId: string;
  }
}
