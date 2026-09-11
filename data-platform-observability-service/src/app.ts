import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { AppError } from "./common/errors/app-error.js";
import { generateCorrelationId } from "./common/ids/id-generator.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { metricsRoutes } from "./modules/metrics/metrics.routes.js";
import { eventsRoutes } from "./api/internal/events.routes.js";
import { internalOperationsRoutes } from "./api/internal/operations.routes.js";
import { internalAlertsRoutes } from "./api/internal/alerts.routes.js";
import { internalIncidentsRoutes } from "./api/internal/incidents.routes.js";
import { internalSlaRoutes } from "./api/internal/sla.routes.js";
import { internalMaintenanceWindowRoutes } from "./api/internal/maintenance-windows.routes.js";
import { customerProductStatusRoutes } from "./api/customer/product-status.routes.js";

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

  // Phase 11 (spec §31/§33): an explicit allowlist, not `origin: true`
  // (reflect-any-origin) — CORS_ALLOWED_ORIGINS is comma-separated.
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: allowedOrigins });

  // Security headers (spec §33) — a conservative baseline appropriate for
  // a JSON API with no rendered HTML: deny framing, disable content-type
  // sniffing, minimize referrer leakage, and lock down an API surface that
  // never needs powerful browser features.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Data Platform Observability Service",
        description:
          "Phase 9 operational control plane: observes, correlates, and evaluates SLA/health/alerts across Phases 1-8's " +
          "independently-owned workflows. Owns no sibling's workflow execution — /v1/customer/* is customer-safe; " +
          "/internal/v1/* and /v1/events are platform/service-to-service only.",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          internalApiKey: { type: "apiKey", in: "header", name: "x-internal-api-key" },
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
        error: { code: error.code, message: error.message, correlationId: request.correlationId },
      });
      return;
    }

    if (error instanceof ZodError || error.validation || error.name === "ZodError") {
      reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: error.message, correlationId: request.correlationId },
      });
      return;
    }

    request.log.error({ err: error, correlationId: request.correlationId }, "Unhandled error");
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", correlationId: request.correlationId },
    });
  });

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(eventsRoutes);
  await app.register(internalOperationsRoutes);
  await app.register(internalAlertsRoutes);
  await app.register(internalIncidentsRoutes);
  await app.register(internalSlaRoutes);
  await app.register(internalMaintenanceWindowRoutes);
  await app.register(customerProductStatusRoutes);

  return app;
}
