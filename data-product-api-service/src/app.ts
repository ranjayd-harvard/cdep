import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { AppError } from "./common/errors/app-error.js";
import { DependencyError } from "./common/errors/dependency-error.js";
import { generateCorrelationId } from "./common/ids/id-generator.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { eventPerformanceRoutes } from "./api/customer/events.routes.js";
import { eventPerformanceQueryDeps, rateLimiter } from "./container.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "req.headers['x-internal-api-key']"],
        censor: "[REDACTED]",
      },
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
          : undefined,
    },
    genReqId: () => randomUUID(),
  });

  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Data Product API — event-performance",
        description:
          "Phase 8 Data Product API Delivery Layer. Authenticated, entitled, tenant-isolated, cursor-paginated " +
          "customer reads of the API Serving Store. /v1/* is customer-facing and requires a Bearer token; " +
          "the Data Product version this serves is resolved per-subscription, never hard-coded.",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.addHook("onRequest", async (request, reply) => {
    const provided = request.headers["x-correlation-id"];
    request.correlationId = typeof provided === "string" && provided.length > 0 ? provided : generateCorrelationId();
    reply.header("X-Correlation-ID", request.correlationId);
  });

  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, correlationId: request.correlationId }, error.message);
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, request_id: request.correlationId },
      });
      return;
    }

    if (error instanceof DependencyError) {
      request.log.error({ service: error.service, correlationId: request.correlationId }, error.message);
      reply.code(503).send({
        error: { code: "SERVICE_UNAVAILABLE", message: `${error.service} is temporarily unavailable.`, request_id: request.correlationId },
      });
      return;
    }

    if (error instanceof ZodError || error.validation || error.name === "ZodError") {
      reply.code(400).send({
        error: { code: "INVALID_REQUEST", message: error.message, request_id: request.correlationId },
      });
      return;
    }

    request.log.error({ err: error, correlationId: request.correlationId }, "Unhandled error");
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", request_id: request.correlationId },
    });
  });

  await app.register(healthRoutes);
  await app.register(eventPerformanceRoutes(eventPerformanceQueryDeps, rateLimiter));

  return app;
}
