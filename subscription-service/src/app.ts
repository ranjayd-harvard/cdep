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
import { customerEntitlementRoutes } from "./api/customer/entitlement.routes.js";
import { customerSubscriptionRoutes } from "./api/customer/subscription.routes.js";
import { internalEntitlementRoutes } from "./api/internal/entitlement.routes.js";
import { internalSubscriptionRoutes } from "./api/internal/subscription.routes.js";

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
        title: "Subscription & Entitlement Management",
        description:
          "Phase 6 control plane: entitlement decisions (may this tenant access this Data Product) and " +
          "subscription/delivery-preference intent (how does the tenant want to consume it). Data Products and " +
          "versions remain owned by data-product-catalog-service. /v1/* is customer-facing; /internal/v1/* is " +
          "platform/service-to-service only.",
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
  await app.register(customerEntitlementRoutes);
  await app.register(customerSubscriptionRoutes);
  await app.register(internalEntitlementRoutes);
  await app.register(internalSubscriptionRoutes);

  return app;
}
