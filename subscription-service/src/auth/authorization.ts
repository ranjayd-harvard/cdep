import type { FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
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
