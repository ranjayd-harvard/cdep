import type { FastifyReply, FastifyRequest } from "fastify";
import { getRequestContext } from "../../auth/authorization.js";
import { parseOrThrow } from "../../common/utils/validate.js";
import {
  getExchangeDetail,
  getExchangeEventsTimeline,
  getExchangeManifestInternal,
  getExchangeValidationResult,
  listExchanges,
  listExchangesInternal,
} from "./exchange.service.js";
import {
  exchangeIdParamSchema,
  listExchangesInternalQuerySchema,
  listExchangesQuerySchema,
} from "./exchange.schemas.js";

export async function listExchangesHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = getRequestContext(request);
  const query = parseOrThrow(listExchangesQuerySchema, request.query);
  const result = await listExchanges(ctx.organizationId, ctx.activeTenantId, query);
  reply.code(200).send(result);
}

export async function getExchangeDetailHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = getRequestContext(request);
  const params = parseOrThrow(exchangeIdParamSchema, request.params);
  const result = await getExchangeDetail(params.exchangeId, ctx.organizationId, ctx.activeTenantId);
  reply.code(200).send(result);
}

export async function getExchangeEventsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = getRequestContext(request);
  const params = parseOrThrow(exchangeIdParamSchema, request.params);
  const result = await getExchangeEventsTimeline(params.exchangeId, ctx.organizationId, ctx.activeTenantId);
  reply.code(200).send({ items: result });
}

export async function getExchangeValidationHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = getRequestContext(request);
  const params = parseOrThrow(exchangeIdParamSchema, request.params);
  const result = await getExchangeValidationResult(params.exchangeId, ctx.organizationId, ctx.activeTenantId);
  reply.code(200).send(result);
}

// Internal-only -- no requireAuth()/getRequestContext() here on purpose;
// gated by requireInternalApiKey at the route level instead.
export async function getExchangeManifestInternalHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseOrThrow(exchangeIdParamSchema, request.params);
  const result = await getExchangeManifestInternal(params.exchangeId);
  reply.code(200).send(result);
}

// Internal-only -- no requireAuth()/getRequestContext() here on purpose;
// gated by requireInternalApiKey at the route level instead.
export async function listExchangesInternalHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = parseOrThrow(listExchangesInternalQuerySchema, request.query);
  const result = await listExchangesInternal(query);
  reply.code(200).send(result);
}
