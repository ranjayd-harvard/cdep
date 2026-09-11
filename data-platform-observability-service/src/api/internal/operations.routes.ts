import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../../auth/internal-auth.middleware.js";
import { AppError } from "../../common/errors/app-error.js";
import { pool } from "../../database/pool.js";
import { OPERATIONAL_STAGES, OPERATIONAL_STATUSES, SLA_STATUSES } from "../../config/constants.js";
import { findExecutionById, listExecutions } from "../../infrastructure/persistence/execution.repository.js";
import { listStageRunsForExecution } from "../../infrastructure/persistence/stage-run.repository.js";
import { queryMetrics } from "../../infrastructure/persistence/metric.repository.js";
import { computeHealthForExecution } from "../../application/services/health-evaluation.service.js";
import { getDeprecatedVersionUsage, getMigrationsRemaining, getVersionAdoption } from "../../application/services/version-adoption.service.js";
import { catalogClient } from "../../container.js";
import { buildTimeline } from "../../domain/timeline.js";
import { detectFailedStage } from "../../domain/failed-stage-detector.js";
import { detectStuckRun } from "../../domain/stuck-run-detector.js";
import { recommendRetry } from "../../domain/retry-recommender.js";
import { defaultStageTargetMinutes } from "../../config/env.js";
import {
  serializeExecution,
  serializeFailedStage,
  serializeHealth,
  serializeRetryRecommendation,
  serializeStageRun,
  serializeTimelineEntry,
} from "../serializers.js";

const executionFilterSchema = z.object({
  organization_id: z.string().optional(),
  tenant_id: z.string().optional(),
  product_version: z.string().optional(),
  status: z.enum(OPERATIONAL_STATUSES).optional(),
  stage: z.enum(OPERATIONAL_STAGES).optional(),
  sla_status: z.enum(SLA_STATUSES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

async function executionDiagnostics(executionId: string, now: Date) {
  const stageRunRows = await listStageRunsForExecution(pool, executionId);
  const stageRunViews = stageRunRows.map((r) => ({ stage: r.stage, status: r.status, attemptNumber: r.attemptNumber, startedAt: r.startedAt, completedAt: r.completedAt }));

  const failedStageResult = detectFailedStage(stageRunViews);

  const runningStage = stageRunRows.find((r) => r.status === "RUNNING" && r.startedAt);
  const stuckResult = runningStage
    ? detectStuckRun({ stage: runningStage.stage, status: "RUNNING", startedAt: runningStage.startedAt }, now, defaultStageTargetMinutes(runningStage.stage) * 2)
    : null;

  let retryRecommendation = null;
  if (failedStageResult.failedStage) {
    const failedRun = stageRunRows.find((r) => r.stage === failedStageResult.failedStage);
    retryRecommendation = recommendRetry({
      executionId,
      failedStage: failedStageResult.failedStage,
      errorCategory: failedRun?.errorCategory ?? null,
      errorMessage: failedRun?.errorMessage ?? null,
    });
  }

  return {
    failed_stage: serializeFailedStage(failedStageResult),
    stuck_run: stuckResult ? { stage: runningStage!.stage, ...stuckResult } : null,
    retry_recommendation: retryRecommendation ? serializeRetryRecommendation(retryRecommendation) : null,
  };
}

// Internal operational APIs (spec section 26) — every route here is
// service/operator-only, gated by requireInternalAuth. Filters accept
// organization_id/tenant_id for administrative cross-tenant queries; safe
// here specifically because the caller already authenticated as a trusted
// internal actor, unlike the customer-safe surface in api/customer.
export async function internalOperationsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/internal/v1/operations/data-products/:productId/health",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations"] } },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const query = z.object({ product_version: z.string().optional(), tenant_id: z.string().optional() }).parse(request.query);

      const page = await listExecutions(pool, {
        dataProductId: productId,
        productVersion: query.product_version,
        tenantId: query.tenant_id,
        limit: 1,
      });
      const latest = page.items[0];
      if (!latest) {
        reply.code(200).send({ status: "UNKNOWN", score: null, component_scores: null, execution_id: null });
        return;
      }

      const health = await computeHealthForExecution(pool, latest.executionId);
      reply.code(200).send({ ...(health ? serializeHealth(health) : { status: "UNKNOWN", score: null, component_scores: null }), execution_id: latest.executionId, data_product_id: productId, product_version: latest.productVersion });
    },
  );

  app.get(
    "/internal/v1/operations/data-products/:productId/executions",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations"] } },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const query = executionFilterSchema.parse(request.query);
      const page = await listExecutions(pool, {
        dataProductId: productId,
        organizationId: query.organization_id,
        tenantId: query.tenant_id,
        productVersion: query.product_version,
        overallStatus: query.status,
        stage: query.stage,
        slaStatus: query.sla_status,
        startedFrom: query.from ? new Date(query.from) : undefined,
        startedTo: query.to ? new Date(query.to) : undefined,
        limit: query.limit,
        offset: query.offset,
      });
      reply.code(200).send({ items: page.items.map(serializeExecution), has_more: page.hasMore });
    },
  );

  // Cross-product overview (spec section 33's dashboard mockup shows a
  // table spanning multiple products at once) — the same filters as the
  // per-product route above, with data_product_id becoming an optional
  // query filter instead of a required path segment.
  app.get(
    "/internal/v1/operations/executions",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations"] } },
    async (request, reply) => {
      const query = executionFilterSchema.extend({ data_product_id: z.string().optional() }).parse(request.query);
      const page = await listExecutions(pool, {
        dataProductId: query.data_product_id,
        organizationId: query.organization_id,
        tenantId: query.tenant_id,
        productVersion: query.product_version,
        overallStatus: query.status,
        stage: query.stage,
        slaStatus: query.sla_status,
        startedFrom: query.from ? new Date(query.from) : undefined,
        startedTo: query.to ? new Date(query.to) : undefined,
        limit: query.limit,
        offset: query.offset,
      });
      reply.code(200).send({ items: page.items.map(serializeExecution), has_more: page.hasMore });
    },
  );

  app.get(
    "/internal/v1/operations/executions/:executionId",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations"] } },
    async (request, reply) => {
      const { executionId } = request.params as { executionId: string };
      const execution = await findExecutionById(pool, executionId);
      if (!execution) throw new AppError("EXECUTION_NOT_FOUND", `Execution '${executionId}' was not found.`);
      const stageRuns = await listStageRunsForExecution(pool, executionId);
      const diagnostics = await executionDiagnostics(executionId, new Date());
      reply.code(200).send({
        ...serializeExecution(execution),
        stage_runs: stageRuns.map(serializeStageRun),
        diagnostics,
      });
    },
  );

  app.get(
    "/internal/v1/operations/executions/:executionId/timeline",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations"] } },
    async (request, reply) => {
      const { executionId } = request.params as { executionId: string };
      const execution = await findExecutionById(pool, executionId);
      if (!execution) throw new AppError("EXECUTION_NOT_FOUND", `Execution '${executionId}' was not found.`);
      const stageRuns = await listStageRunsForExecution(pool, executionId);
      const timeline = buildTimeline(
        stageRuns.map((r) => ({
          stage: r.stage,
          status: r.status,
          sourceService: r.sourceService,
          sourceEntityId: r.sourceEntityId,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          durationMs: r.durationMs,
          errorMessage: r.errorMessage,
        })),
      );
      reply.code(200).send({ execution_id: executionId, items: timeline.map(serializeTimelineEntry) });
    },
  );

  app.get(
    "/internal/v1/operations/executions/:executionId/metrics",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations"] } },
    async (request, reply) => {
      const { executionId } = request.params as { executionId: string };
      const execution = await findExecutionById(pool, executionId);
      if (!execution) throw new AppError("EXECUTION_NOT_FOUND", `Execution '${executionId}' was not found.`);
      const stageRuns = await listStageRunsForExecution(pool, executionId);
      reply.code(200).send({
        execution_id: executionId,
        // Execution-scoped view derived directly from this execution's own
        // stage runs — distinct from the platform-level dimensional rollup
        // at GET /internal/v1/operations/metrics (operational_metrics never
        // carries an execution_id, spec section 16).
        stage_durations_ms: Object.fromEntries(stageRuns.filter((r) => r.durationMs !== null).map((r) => [r.stage, r.durationMs])),
      });
    },
  );

  app.get(
    "/internal/v1/operations/metrics",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations"] } },
    async (request, reply) => {
      const query = z
        .object({
          metric_name: z.string().optional(),
          data_product_id: z.string().optional(),
          product_version: z.string().optional(),
          tenant_id: z.string().optional(),
          stage: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          limit: z.coerce.number().int().positive().max(1000).optional(),
        })
        .parse(request.query);
      const rows = await queryMetrics(pool, {
        metricName: query.metric_name,
        dataProductId: query.data_product_id,
        productVersion: query.product_version,
        tenantId: query.tenant_id,
        stage: query.stage,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        limit: query.limit,
      });
      reply.code(200).send({ items: rows });
    },
  );

  // Phase 10 §41/§58/§60: per-version health, mirroring the existing
  // per-product health route one level deeper (same underlying query,
  // this is purely a discoverability/URL-shape convenience — the
  // ?product_version= filter above already scopes to one version).
  app.get(
    "/internal/v1/operations/data-products/:productId/versions/:version/health",
    {
      preHandler: [requireInternalAuth()],
      schema: { tags: ["internal", "operations", "versions"], params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } } },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const page = await listExecutions(pool, { dataProductId: productId, productVersion: version, limit: 1 });
      const latest = page.items[0];
      if (!latest) {
        reply.code(200).send({ status: "UNKNOWN", score: null, component_scores: null, execution_id: null, data_product_id: productId, product_version: version });
        return;
      }
      const health = await computeHealthForExecution(pool, latest.executionId);
      reply.code(200).send({
        ...(health ? serializeHealth(health) : { status: "UNKNOWN", score: null, component_scores: null }),
        execution_id: latest.executionId,
        data_product_id: productId,
        product_version: version,
      });
    },
  );

  // Phase 10 §41/§61: per-version adoption across the whole product.
  app.get(
    "/internal/v1/operations/data-products/:productId/versions/adoption",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations", "versions"], params: { type: "object", properties: { productId: { type: "string" } } } } },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const items = await getVersionAdoption(pool, catalogClient, productId);
      reply.code(200).send({
        items: items.map((i) => ({
          version: i.version,
          lifecycle_status: i.lifecycleStatus,
          subscriber_count: i.subscriberCount,
          adoption_percentage: i.adoptionPercentage,
          execution_count: i.executionCount,
          failure_count: i.failureCount,
          sla_pass_rate: i.slaPassRate,
        })),
      });
    },
  );

  // Phase 10 §62: continuing use of DEPRECATED versions specifically.
  app.get(
    "/internal/v1/operations/data-products/:productId/versions/deprecated-usage",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations", "versions"], params: { type: "object", properties: { productId: { type: "string" } } } } },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const items = await getDeprecatedVersionUsage(pool, catalogClient, productId);
      reply.code(200).send({
        items: items.map((i) => ({
          version: i.version,
          subscriber_count: i.subscriberCount,
          execution_count: i.executionCount,
        })),
      });
    },
  );

  // Phase 10 §41: read-only passthrough of Catalog's migration plans.
  app.get(
    "/internal/v1/operations/data-products/:productId/migrations-remaining",
    { preHandler: [requireInternalAuth()], schema: { tags: ["internal", "operations", "versions"], params: { type: "object", properties: { productId: { type: "string" } } } } },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const { migrations, totalPending } = await getMigrationsRemaining(catalogClient, productId);
      reply.code(200).send({
        total_pending: totalPending,
        migrations: migrations.map((m) => ({
          migration_id: m.migrationId,
          to_version: m.toVersion,
          status: m.status,
          pending_subscriptions: m.pendingSubscriptions,
        })),
      });
    },
  );
}
