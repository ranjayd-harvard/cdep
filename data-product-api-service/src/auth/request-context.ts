import type { Role } from "../config/constants.js";

// The trusted SecurityContext (spec §8.5) — established once per request
// from the validated bearer token only, never from query/path/body.
// `?tenant_id=` and friends are simply never read for identity anywhere in
// this service.
export interface SecurityContext {
  subjectId: string;
  organizationId: string;
  activeTenantId: string;
  roles: Role[];
  authenticationMethod: "DEV_TOKEN" | "OIDC";
}

declare module "fastify" {
  interface FastifyRequest {
    securityContext?: SecurityContext;
    correlationId: string;
  }
}
