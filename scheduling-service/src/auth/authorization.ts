import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import type { Role } from "../config/constants.js";
import type { ActorContext, TenantContext } from "./request-context.js";

export function getTenantContext(request: FastifyRequest): TenantContext {
  if (!request.tenantContext) {
    throw new AppError("UNAUTHENTICATED", "Request is not authenticated.");
  }
  return request.tenantContext;
}

export function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.actorContext) {
    throw new AppError("UNAUTHENTICATED", "Request is not authenticated.");
  }
  return request.actorContext;
}

// Server-side permission matrix (spec §9/§10).
export type Permission = "operations.read" | "publication.trigger";

const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  CUSTOMER_ADMIN: ["operations.read", "publication.trigger"],
  CUSTOMER_USER: ["operations.read", "publication.trigger"],
  CUSTOMER_READONLY: ["operations.read"],
  PRODUCT_CONSUMER: ["operations.read", "publication.trigger"],
  PRODUCT_OWNER: ["operations.read"],
  DATA_STEWARD: ["operations.read"],
  PLATFORM_OPERATOR: ["operations.read", "publication.trigger"],
  SECURITY_ADMIN: ["operations.read"],
  PLATFORM_ADMIN: ["operations.read", "publication.trigger"],
  SERVICE: ["operations.read", "publication.trigger"],
  SCHEDULER_ADMIN: ["operations.read", "publication.trigger"],
  CATALOG_READER: ["operations.read"],
  SCHEDULER_READER: ["operations.read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].includes(permission);
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const ctx = getTenantContext(request);
    if (!hasPermission(ctx.role, permission)) {
      throw new AppError("FORBIDDEN", `Role ${ctx.role} does not have permission to ${permission}.`);
    }
  };
}

export interface AuthorizationDecision {
  decision: "ALLOW" | "DENY";
  resource: string;
  tenantId: string;
  policyVersion: string;
  reasonCode: string;
}

export function authorize(ctx: TenantContext, permission: Permission, resource: string): AuthorizationDecision {
  const allowed = hasPermission(ctx.role, permission);
  return {
    decision: allowed ? "ALLOW" : "DENY",
    resource,
    tenantId: ctx.activeTenantId,
    policyVersion: "1.0",
    reasonCode: allowed ? "ROLE_PERMITTED" : "ROLE_NOT_PERMITTED",
  };
}
