import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import type { Role } from "../config/constants.js";
import type { RequestContext } from "./request-context.js";

// Server-side permission matrix — see AGENTS.md section 5. The Customer
// Portal's own UI gating is not trusted; every mutating/read endpoint
// re-checks permissions here.
export type Permission = "upload" | "download" | "view_history" | "manage_tenant_config";

const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  CUSTOMER_ADMIN: ["upload", "download", "view_history", "manage_tenant_config"],
  CUSTOMER_USER: ["upload", "download", "view_history"],
  CUSTOMER_READONLY: ["download", "view_history"],
  SERVICE_ACCOUNT: ["upload", "download", "view_history"],
  PLATFORM_ADMIN: ["upload", "download", "view_history", "manage_tenant_config"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].includes(permission);
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const ctx = getRequestContext(request);
    if (!hasPermission(ctx.role, permission)) {
      throw new AppError("FORBIDDEN", `Role ${ctx.role} does not have permission to ${permission}.`);
    }
  };
}

export function getRequestContext(request: FastifyRequest): RequestContext {
  if (!request.requestContext) {
    throw new AppError("UNAUTHENTICATED", "Request is not authenticated.");
  }
  return request.requestContext;
}
