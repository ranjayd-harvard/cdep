import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import type { Role } from "../config/constants.js";
import { getSecurityContext } from "./customer-auth.middleware.js";

// Server-side permission matrix (spec §9/§10) — replaces scattered
// role-equality checks with a single "does this principal have permission
// X" question.
export type Permission = "product.read";

const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  CUSTOMER_ADMIN: ["product.read"],
  CUSTOMER_USER: ["product.read"],
  CUSTOMER_READONLY: ["product.read"],
  PLATFORM_ADMIN: ["product.read"],
  PRODUCT_CONSUMER: ["product.read"],
  PRODUCT_OWNER: ["product.read"],
  DATA_STEWARD: ["product.read"],
  PLATFORM_OPERATOR: ["product.read"],
  SECURITY_ADMIN: ["product.read"],
  SERVICE: ["product.read"],
};

function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => PERMISSIONS_BY_ROLE[role].includes(permission));
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const ctx = getSecurityContext(request);
    if (!hasPermission(ctx.roles, permission)) {
      // This service's anti-enumeration convention (spec §8.16-19): a
      // permission denial collapses to the same PRODUCT_NOT_FOUND every
      // other authorization failure here does, never a distinct 403.
      throw new AppError("PRODUCT_NOT_FOUND", "Data product was not found.");
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

export function authorize(
  ctx: { roles: readonly Role[]; activeTenantId: string },
  permission: Permission,
  resource: string,
): AuthorizationDecision {
  const allowed = hasPermission(ctx.roles, permission);
  return {
    decision: allowed ? "ALLOW" : "DENY",
    resource,
    tenantId: ctx.activeTenantId,
    policyVersion: "1.0",
    reasonCode: allowed ? "ROLE_PERMITTED" : "ROLE_NOT_PERMITTED",
  };
}
