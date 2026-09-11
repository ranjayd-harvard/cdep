import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth, getSecurityContext } from "../../auth/customer-auth.middleware.js";
import { requirePermission } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { computeEtag } from "../../domain/etag.js";
import { filterFingerprint } from "../../domain/cursor.js";
import {
  RESOURCE,
  runEventPerformanceQuery,
  runEventPerformanceQueryForExplicitVersion,
  type EventPerformanceQueryDeps,
  type EventPerformanceQueryResult,
} from "../../application/services/event-performance-query.service.js";
import type { RateLimiter } from "../../ports/rate-limiter.port.js";
import { logger } from "../../common/logger/logger.js";

const REQUEST_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError("REQUEST_TIMEOUT", `Request exceeded ${ms}ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function eventPerformanceRoutes(deps: EventPerformanceQueryDeps, rateLimiter: RateLimiter) {
  return async function register(app: FastifyInstance): Promise<void> {
    // The route is deliberately literal ("event-performance"/"events"), not
    // a generic /:productId/:resource — spec §8.2's vertical slice is one
    // Data Product/one resource; a second one would earn its own route +
    // its own Catalog-resolved contract, not a parameterized catch-all that
    // has to guess which serving-store table to query.
    app.get(
      "/v1/data-products/event-performance/events",
      {
        preHandler: [requireAuth(), requirePermission("product.read")],
        schema: {
          tags: ["data-products"],
          summary: "Query the event-performance Data Product's events resource (spec §8.2). Version is resolved per-subscription, never hard-coded.",
          security: [{ bearerAuth: [] }],
          // Documentation only, deliberately loose (additionalProperties:
          // true) — the Contract-driven allowlist in contract-policy.ts,
          // not this JSON Schema, is the actual source of truth for which
          // filters/sorts/fields a given resolved product version accepts.
          querystring: {
            type: "object",
            additionalProperties: true,
            properties: {
              event_id: { type: "string" },
              venue_id: { type: "string" },
              event_date_from: { type: "string", format: "date" },
              event_date_to: { type: "string", format: "date" },
              updated_since: { type: "string", format: "date-time" },
              sort: { type: "string", description: "Comma-separated, e.g. \"event_date,event_id\"." },
              cursor: { type: "string", description: "Opaque, from a previous response's page.next_cursor." },
              page_size: { type: "integer", minimum: 1, maximum: 500, default: 100 },
              fields: { type: "string", description: "Comma-separated subset of the published fields." },
            },
          },
          response: {
            200: {
              description: "A page of matching events, contract-projected.",
              type: "object",
              properties: {
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      event_id: { type: "string" },
                      venue_id: { type: "string" },
                      event_date: { type: "string", format: "date" },
                      tickets_sold: { type: ["integer", "null"] },
                      gross_revenue: { type: ["string", "null"] },
                      revenue_per_ticket: { type: ["string", "null"] },
                    },
                  },
                },
                page: { type: "object", properties: { next_cursor: { type: ["string", "null"] }, page_size: { type: "integer" } } },
                product: { type: "object", properties: { id: { type: "string" }, version: { type: "string" } } },
                freshness: { type: "object", properties: { serving_snapshot: { type: ["string", "null"] }, as_of: { type: "string" } } },
                request_id: { type: "string" },
              },
            },
            "4xx": {
              description: "Stable error envelope (spec §8.10).",
              type: "object",
              properties: {
                error: {
                  type: "object",
                  properties: { code: { type: "string" }, message: { type: "string" }, request_id: { type: "string" } },
                },
              },
            },
          },
        },
      },
      (request, reply) => handleQuery(request, reply, "/v1/data-products/event-performance/events", (securityContext, rawQuery) =>
        runEventPerformanceQuery(deps, securityContext, RESOURCE, rawQuery),
      ),
    );

    // Phase 10 §38: explicit-version access. `/v1` (this file's route
    // prefix) is the API platform version; `:version` here is the Data
    // Product version — kept syntactically and semantically separate,
    // never derived from one another. Resolves via Catalog's shared
    // resolver (EXACT/DELIVER) instead of the subscription's stored
    // floating policy, so an existing subscriber can read a DEPRECATED
    // version mid-grace-period, or an opted-in tenant can read a BETA
    // version, explicitly — while still requiring the same entitlement +
    // active-API-subscription check as the default route.
    app.get(
      "/v1/data-products/event-performance/versions/:version/events",
      {
        preHandler: [requireAuth(), requirePermission("product.read")],
        schema: {
          tags: ["data-products"],
          summary: "Query event-performance at an explicit Data Product version (spec §38), bypassing the subscription's floating policy resolution.",
          security: [{ bearerAuth: [] }],
          params: { type: "object", properties: { version: { type: "string" } }, required: ["version"] },
          querystring: { type: "object", additionalProperties: true },
        },
      },
      (request, reply) => {
        const { version } = request.params as { version: string };
        return handleQuery(request, reply, `/v1/data-products/event-performance/versions/${version}/events`, (securityContext, rawQuery) =>
          runEventPerformanceQueryForExplicitVersion(deps, securityContext, RESOURCE, version, rawQuery),
        );
      },
    );

    async function handleQuery(
      request: FastifyRequest,
      reply: FastifyReply,
      endpointLabel: string,
      run: (securityContext: ReturnType<typeof getSecurityContext>, rawQuery: Record<string, unknown>) => Promise<EventPerformanceQueryResult>,
    ): Promise<void> {
      const startedAt = Date.now();
      const securityContext = getSecurityContext(request);

      const rateLimitKey = `${securityContext.organizationId}:${securityContext.activeTenantId}:event-performance:events`;
      const { allowed } = await rateLimiter.checkAndConsume(rateLimitKey);
      if (!allowed) {
        throw new AppError("RATE_LIMIT_EXCEEDED", "Too many requests. Please slow down.");
      }

      const result = await withTimeout(run(securityContext, request.query as Record<string, unknown>), REQUEST_TIMEOUT_MS);

      const etag = computeEtag({
        organizationId: securityContext.organizationId,
        tenantId: securityContext.activeTenantId,
        productId: result.product.id,
        version: result.product.version,
        resource: "events",
        queryFingerprint: filterFingerprint(request.query as Record<string, string | undefined>),
        fields: typeof (request.query as Record<string, unknown>)["fields"] === "string" ? (request.query as { fields: string }).fields.split(",") : null,
        cursor: typeof (request.query as Record<string, unknown>)["cursor"] === "string" ? (request.query as { cursor: string }).cursor : null,
        servingSnapshot: result.freshness.servingSnapshot,
      });

      reply.header("ETag", etag);
      if (request.headers["if-none-match"] === etag) {
        reply.code(304).send();
        return;
      }

      logger.info(
        {
          request_id: request.correlationId,
          tenant_id: securityContext.activeTenantId,
          data_product_id: result.product.id,
          resolved_product_version: result.product.version,
          api_version: "v1",
          endpoint: endpointLabel,
          result_count: result.data.length,
          status: 200,
          serving_snapshot: result.freshness.servingSnapshot,
          latency_ms: Date.now() - startedAt,
          response_bytes: result.responseBytes,
        },
        "DATA_PRODUCT_API_QUERY",
      );

      reply.code(200).send({
        data: result.data,
        page: { next_cursor: result.page.nextCursor, page_size: result.page.pageSize },
        product: { id: result.product.id, version: result.product.version },
        freshness: { serving_snapshot: result.freshness.servingSnapshot, as_of: result.freshness.asOf },
        request_id: request.correlationId,
      });
    }
  };
}
