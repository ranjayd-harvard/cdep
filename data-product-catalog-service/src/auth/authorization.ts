import type { FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import type { RequestContext } from "./request-context.js";

export function getRequestContext(request: FastifyRequest): RequestContext {
  if (!request.requestContext) {
    throw new AppError("UNAUTHENTICATED", "Request is not authenticated.");
  }
  return request.requestContext;
}
