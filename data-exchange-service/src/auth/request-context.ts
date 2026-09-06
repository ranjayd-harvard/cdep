import type { Role } from "../config/constants.js";

// Established once per authenticated request, from the validated token
// only. Never populated from query params, path params, form fields, or
// request bodies — see AGENTS.md section 4.
export interface RequestContext {
  userId: string;
  organizationId: string;
  activeTenantId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    requestContext?: RequestContext;
    correlationId: string;
  }
}
