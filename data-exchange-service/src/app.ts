import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { AppError } from "./common/errors/app-error.js";
import { exchangeRoutes } from "./modules/exchanges/exchange.routes.js";
import { uploadRoutes } from "./modules/uploads/upload.routes.js";
import { downloadRoutes } from "./modules/downloads/download.routes.js";
import { publicationRoutes } from "./modules/publications/publication.routes.js";
import { outboundPublicationRoutes } from "./modules/outbound-publications/outbound-publication.routes.js";
import { pipelineJobRoutes } from "./modules/pipeline-jobs/pipeline-job.routes.js";
import { dataProductRoutes } from "./modules/data-products/data-product.routes.js";
import { catalogSyncRoutes } from "./modules/catalog-sync/catalog-sync.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { retentionRoutes } from "./retention/retention.routes.js";
import { generateCorrelationId } from "./common/ids/id-generator.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "*.jwt", "*.token", "*.signedUrl", "*.downloadUrl", "*.uploadUrl"],
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
        title: "Data Exchange Service",
        description:
          "Exchange control plane and secure storage gateway for the Customer Data Exchange Platform. " +
          "Manages inbound/outbound exchange lifecycle, manifests, validation, and signed upload/download URLs.",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // Correlation ID: honor X-Correlation-ID if provided, otherwise mint one.
  // Never treated as an authorization identifier (AGENTS.md section 43) —
  // it flows into logs/events/responses only.
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

    // Fastify's built-in schema-validation errors.
    if ((error as { validation?: unknown }).validation) {
      reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: error.message, correlationId: request.correlationId },
      });
      return;
    }

    request.log.error({ err: error, correlationId: request.correlationId }, "Unhandled error");
    reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        correlationId: request.correlationId,
      },
    });
  });

  await app.register(healthRoutes);
  await app.register(exchangeRoutes);
  await app.register(uploadRoutes);
  await app.register(downloadRoutes);
  await app.register(publicationRoutes);
  await app.register(outboundPublicationRoutes);
  await app.register(pipelineJobRoutes);
  await app.register(dataProductRoutes);
  await app.register(catalogSyncRoutes);
  await app.register(retentionRoutes);

  return app;
}
