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
