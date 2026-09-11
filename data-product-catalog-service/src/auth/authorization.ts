import type { FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import type { Role } from "../config/constants.js";
import type { RequestContext } from "./request-context.js";

export function getRequestContext(request: FastifyRequest): RequestContext {
  if (!request.requestContext) {
    throw new AppError("UNAUTHENTICATED", "Request is not authenticated.");
  }
  return request.requestContext;
}

// Server-side permission matrix (spec §9/§10). This service's existing
// requireInternalAuth(minimumRole) checks already gate each internal route
// by a specific named role; this matrix documents what those roles mean in
// permission terms and is what M9's audit payload references, rather than
// a second competing authorization mechanism.
export type Permission = "catalog.read" | "catalog.manage" | "governance.read" | "governance.manage";

const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  CATALOG_READER: ["catalog.read", "governance.read"],
  CONTRACT_REGISTRAR: ["catalog.read", "catalog.manage", "governance.read"],
  PRODUCT_ADMIN: ["catalog.read", "catalog.manage", "governance.read", "governance.manage"],
  PLATFORM_ADMIN: ["catalog.read", "catalog.manage", "governance.read", "governance.manage"],
  DATA_STEWARD: ["catalog.read", "governance.read", "governance.manage"],
  PLATFORM_OPERATOR: ["catalog.read", "governance.read"],
  SECURITY_ADMIN: ["catalog.read", "governance.read"],
  SERVICE: ["catalog.read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].includes(permission);
}

export interface AuthorizationDecision {
  decision: "ALLOW" | "DENY";
  resource: string;
  tenantId: string;
  policyVersion: string;
  reasonCode: string;
}

export function authorize(role: Role, permission: Permission, resource: string, tenantId = "platform"): AuthorizationDecision {
  const allowed = hasPermission(role, permission);
  return {
    decision: allowed ? "ALLOW" : "DENY",
    resource,
    tenantId,
    policyVersion: "1.0",
    reasonCode: allowed ? "ROLE_PERMITTED" : "ROLE_NOT_PERMITTED",
  };
}
