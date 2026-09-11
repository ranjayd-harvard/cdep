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

// Admin/entitlement-grant capabilities are never exposed to ordinary
// tenant customer roles (spec §33). ENTITLEMENT_ADMIN and PLATFORM_ADMIN
// are the only roles permitted through requireInternalAuth("ENTITLEMENT_ADMIN").

// Server-side permission matrix (spec §9/§10) — mirrors the pattern
// data-exchange-service established. Customer routes gate on this instead
// of comparing `ctx.role` directly.
export type Permission = "subscription.read" | "subscription.manage";

const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  CUSTOMER_ADMIN: ["subscription.read", "subscription.manage"],
  CUSTOMER_USER: ["subscription.read", "subscription.manage"],
  CUSTOMER_READONLY: ["subscription.read"],
  PRODUCT_CONSUMER: ["subscription.read", "subscription.manage"],
  PRODUCT_OWNER: ["subscription.read"],
  DATA_STEWARD: ["subscription.read"],
  PLATFORM_OPERATOR: ["subscription.read", "subscription.manage"],
  SECURITY_ADMIN: ["subscription.read"],
  PLATFORM_ADMIN: ["subscription.read", "subscription.manage"],
  SERVICE: ["subscription.read", "subscription.manage"],
  ENTITLEMENT_ADMIN: ["subscription.read", "subscription.manage"],
  CATALOG_READER: ["subscription.read"],
  SCHEDULER_READER: ["subscription.read"],
  DATA_PRODUCT_API_READER: ["subscription.read"],
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

// Non-leaky decision record (spec §10) — used for the security audit
// payload (never returned to the customer verbatim, spec §32).
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
