import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { AppError } from "./common/errors/app-error.js";
import { generateCorrelationId } from "./common/ids/id-generator.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { domainRoutes } from "./modules/domains/domain.routes.js";
import { ownerRoutes } from "./modules/owners/owner.routes.js";
import { productRoutes } from "./modules/products/product.routes.js";
import { versionRoutes } from "./modules/versions/version.routes.js";
import { contractRoutes } from "./modules/contracts/contract.routes.js";
import { registrationRoutes } from "./registration/registration.routes.js";
import { dependencyRoutes } from "./modules/dependencies/dependency.routes.js";
import { resolverRoutes } from "./modules/version-resolution/resolver.routes.js";
import { migrationPlanRoutes } from "./modules/migrations/migration-plan.routes.js";
import { RetirementBlockedError } from "./modules/lifecycle/retirement-guard.js";

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
        title: "Data Product Catalog & Contract Registry",
        description:
          "Runtime authoritative registry for Data Products, versions, schemas, contracts, SLA, quality, and " +
          "delivery metadata. Git + CI remain the Contract-as-Code authoring source; this service is the " +
          "operational and customer-facing system of record fed by contract registration. " +
          "/v1/* is customer-facing read-only metadata. /internal/v1/* is platform/service-to-service only.",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          internalApiKey: { type: "apiKey", in: "header", name: "x-internal-api-key" },
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
      const body: { error: Record<string, unknown> } = {
        error: { code: error.code, message: error.message, correlationId: request.correlationId },
      };
      // Phase 10 §22/§28: the one deliberate exception to the flat error
      // envelope — retirement rejections carry the full structured
      // blocker list, not just a message.
      if (error instanceof RetirementBlockedError) {
        body.error.blockers = error.blockers;
      }
      reply.code(error.statusCode).send(body);
      return;
    }

    if ((error as { validation?: unknown }).validation || error.name === "ZodError") {
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
  await app.register(domainRoutes);
  await app.register(ownerRoutes);
  await app.register(productRoutes);
  await app.register(versionRoutes);
  await app.register(contractRoutes);
  await app.register(registrationRoutes);
  await app.register(dependencyRoutes);
  await app.register(resolverRoutes);
  await app.register(migrationPlanRoutes);

  return app;
}
