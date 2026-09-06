import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../auth/auth.middleware.js";
import { requirePermission } from "../../auth/authorization.js";
import { requireInternalApiKey } from "../../auth/internal-auth.middleware.js";
import {
  getExchangeDetailHandler,
  getExchangeEventsHandler,
  getExchangeManifestInternalHandler,
  getExchangeValidationHandler,
  listExchangesHandler,
  listExchangesInternalHandler,
} from "./exchange.controller.js";

export async function exchangeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/exchanges",
    {
      preHandler: [requireAuth(), requirePermission("view_history")],
      schema: {
        tags: ["exchanges"],
        summary: "List exchanges scoped to the authenticated organization/tenant.",
        querystring: {
          type: "object",
          properties: {
            direction: { type: "string" },
            status: { type: "string" },
            dataProductId: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            limit: { type: "number" },
            cursor: { type: "string" },
          },
        },
      },
    },
    listExchangesHandler,
  );

  app.get(
    "/v1/exchanges/:exchangeId",
    {
      preHandler: [requireAuth(), requirePermission("view_history")],
      schema: {
        tags: ["exchanges"],
        summary: "Get exchange detail.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    getExchangeDetailHandler,
  );

  app.get(
    "/v1/exchanges/:exchangeId/events",
    {
      preHandler: [requireAuth(), requirePermission("view_history")],
      schema: {
        tags: ["exchanges"],
        summary: "Get the lifecycle event timeline for an exchange.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    getExchangeEventsHandler,
  );

  app.get(
    "/v1/exchanges/:exchangeId/validation",
    {
      preHandler: [requireAuth(), requirePermission("view_history")],
      schema: {
        tags: ["exchanges"],
        summary: "Get customer-safe validation results for an exchange.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    getExchangeValidationHandler,
  );

  // Internal-only surface for the Phase 2 lakehouse ingestion pipeline --
  // protected by requireInternalApiKey, NOT customer JWT auth (AGENTS.md
  // section 10/34; mirrors the existing /internal/v1/publications pattern).
  app.get(
    "/internal/v1/exchanges/:exchangeId/manifest",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Fetch an exchange's manifest plus its data file's storage coordinates.",
        params: { type: "object", properties: { exchangeId: { type: "string" } } },
      },
    },
    getExchangeManifestInternalHandler,
  );

  // Internal-only, cross-tenant surface for the superadmin portal's
  // Lakehouse Ingestion admin page (/admin/lakehouse) -- protected by
  // requireInternalApiKey, NOT customer JWT auth. Unlike /v1/exchanges
  // above, this is not scoped to one organization/tenant.
  app.get(
    "/internal/v1/exchanges",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "List exchanges across all tenants (superadmin portal only).",
        querystring: {
          type: "object",
          properties: {
            direction: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
    },
    listExchangesInternalHandler,
  );
}
