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
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, correlationId: request.correlationId },
      });
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

  return app;
}
