import type pg from "pg";
import type { HealthStatus, OperationalStage, OperationalStatus, SlaStatus } from "../../config/constants.js";

export interface OperationalExecutionRow {
  executionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  subscriptionId: string | null;
  scheduledRunId: string | null;
  inboundExchangeId: string | null;
  ingestionId: string | null;
  silverPipelineRunId: string | null;
  goldPipelineRunId: string | null;
  publicationId: string | null;
  outboundExchangeId: string | null;
  deliveryRequestId: string | null;
  apiRequestId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  currentStage: OperationalStage | null;
  overallStatus: OperationalStatus;
  technicalSlaStatus: SlaStatus;
  businessSlaStatus: SlaStatus;
  healthStatus: HealthStatus;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ExecutionRowWire {
  execution_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  product_version: string;
  subscription_id: string | null;
  scheduled_run_id: string | null;
  inbound_exchange_id: string | null;
  ingestion_id: string | null;
  silver_pipeline_run_id: string | null;
  gold_pipeline_run_id: string | null;
  publication_id: string | null;
  outbound_exchange_id: string | null;
  delivery_request_id: string | null;
  api_request_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  current_stage: OperationalStage | null;
  overall_status: OperationalStatus;
  technical_sla_status: SlaStatus;
  business_sla_status: SlaStatus;
  health_status: HealthStatus;
  correlation_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function fromWire(row: ExecutionRowWire): OperationalExecutionRow {
  return {
    executionId: row.execution_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    productVersion: row.product_version,
    subscriptionId: row.subscription_id,
    scheduledRunId: row.scheduled_run_id,
    inboundExchangeId: row.inbound_exchange_id,
    ingestionId: row.ingestion_id,
    silverPipelineRunId: row.silver_pipeline_run_id,
    goldPipelineRunId: row.gold_pipeline_run_id,
    publicationId: row.publication_id,
    outboundExchangeId: row.outbound_exchange_id,
    deliveryRequestId: row.delivery_request_id,
    apiRequestId: row.api_request_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    currentStage: row.current_stage,
    overallStatus: row.overall_status,
    technicalSlaStatus: row.technical_sla_status,
    businessSlaStatus: row.business_sla_status,
    healthStatus: row.health_status,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createExecution(
  client: pg.Pool | pg.PoolClient,
  params: {
    executionId: string;
    organizationId: string;
    tenantId: string;
    dataProductId: string;
    productVersion: string;
    subscriptionId: string | null;
    scheduledRunId: string | null;
    correlationId: string | null;
  },
): Promise<OperationalExecutionRow> {
  const { rows } = await client.query<ExecutionRowWire>(
    `INSERT INTO operational_executions
       (execution_id, organization_id, tenant_id, data_product_id, product_version,
        subscription_id, scheduled_run_id, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.executionId,
      params.organizationId,
      params.tenantId,
      params.dataProductId,
      params.productVersion,
      params.subscriptionId,
      params.scheduledRunId,
      params.correlationId,
    ],
  );
  return fromWire(rows[0]!);
}

export async function findExecutionById(client: pg.Pool | pg.PoolClient, executionId: string): Promise<OperationalExecutionRow | null> {
  const { rows } = await client.query<ExecutionRowWire>("SELECT * FROM operational_executions WHERE execution_id = $1", [executionId]);
  return rows[0] ? fromWire(rows[0]) : null;
}

// The correlation heuristic fallback (plan section 5, domain/correlation.ts)
// — the most recent still-open execution in this exact scope, within the
// configurable correlation window. Only consulted when no exact identifier
// match exists.
export async function findMostRecentOpenExecution(
  client: pg.Pool | pg.PoolClient,
  scope: { organizationId: string; tenantId: string; dataProductId: string; productVersion: string },
  windowMinutes: number,
): Promise<string | null> {
  const { rows } = await client.query<{ execution_id: string }>(
    `SELECT execution_id FROM operational_executions
     WHERE organization_id = $1 AND tenant_id = $2 AND data_product_id = $3 AND product_version = $4
       AND completed_at IS NULL
       AND started_at > now() - ($5 || ' minutes')::interval
     ORDER BY started_at DESC
     LIMIT 1`,
    [scope.organizationId, scope.tenantId, scope.dataProductId, scope.productVersion, windowMinutes],
  );
  return rows[0]?.execution_id ?? null;
}

// Early pipeline stages (exchange received, Bronze ingestion) don't yet
// know the resolved product_version — normalizers use the placeholder
// "unresolved" (see application/normalizers) until Silver/Gold/publication
// resolves it. Once a later event on the SAME execution (matched via the
// join-key ID chain, not scope) carries a real version, this corrects the
// execution's own column — a no-op once already resolved.
export async function backfillProductVersionIfUnresolved(
  client: pg.Pool | pg.PoolClient,
  executionId: string,
  productVersion: string,
): Promise<void> {
  if (productVersion === "unresolved") return;
  await client.query(
    `UPDATE operational_executions SET product_version = $2, updated_at = now()
     WHERE execution_id = $1 AND product_version = 'unresolved'`,
    [executionId, productVersion],
  );
}

export async function updateExecutionRollup(
  client: pg.Pool | pg.PoolClient,
  executionId: string,
  fields: Partial<{
    startedAt: Date | null;
    completedAt: Date | null;
    currentStage: OperationalStage | null;
    overallStatus: OperationalStatus;
    technicalSlaStatus: SlaStatus;
    businessSlaStatus: SlaStatus;
    healthStatus: HealthStatus;
    // Correlation-chain columns, filled in incrementally as later stages resolve.
    subscriptionId: string;
    scheduledRunId: string;
    inboundExchangeId: string;
    ingestionId: string;
    silverPipelineRunId: string;
    goldPipelineRunId: string;
    publicationId: string;
    outboundExchangeId: string;
    deliveryRequestId: string;
    apiRequestId: string;
  }>,
): Promise<void> {
  const columnByKey: Record<string, string> = {
    startedAt: "started_at",
    completedAt: "completed_at",
    currentStage: "current_stage",
    overallStatus: "overall_status",
    technicalSlaStatus: "technical_sla_status",
    businessSlaStatus: "business_sla_status",
    healthStatus: "health_status",
    subscriptionId: "subscription_id",
    scheduledRunId: "scheduled_run_id",
    inboundExchangeId: "inbound_exchange_id",
    ingestionId: "ingestion_id",
    silverPipelineRunId: "silver_pipeline_run_id",
    goldPipelineRunId: "gold_pipeline_run_id",
    publicationId: "publication_id",
    outboundExchangeId: "outbound_exchange_id",
    deliveryRequestId: "delivery_request_id",
    apiRequestId: "api_request_id",
  };

  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const setClauses = entries.map(([key], idx) => `${columnByKey[key]} = $${idx + 2}`);
  const values = entries.map(([, v]) => v);

  await client.query(
    `UPDATE operational_executions SET ${setClauses.join(", ")}, updated_at = now() WHERE execution_id = $1`,
    [executionId, ...values],
  );
}

export interface ExecutionListFilters {
  organizationId?: string;
  tenantId?: string;
  dataProductId?: string;
  productVersion?: string;
  overallStatus?: OperationalStatus;
  stage?: OperationalStage;
  startedFrom?: Date;
  startedTo?: Date;
  slaStatus?: SlaStatus;
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export async function listExecutions(client: pg.Pool | pg.PoolClient, filters: ExecutionListFilters): Promise<Page<OperationalExecutionRow>> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function add(condition: string, value: unknown) {
    values.push(value);
    conditions.push(condition.replace("?", `$${values.length}`));
  }

  if (filters.organizationId) add("organization_id = ?", filters.organizationId);
  if (filters.tenantId) add("tenant_id = ?", filters.tenantId);
  if (filters.dataProductId) add("data_product_id = ?", filters.dataProductId);
  if (filters.productVersion) add("product_version = ?", filters.productVersion);
  if (filters.overallStatus) add("overall_status = ?", filters.overallStatus);
  if (filters.stage) add("current_stage = ?", filters.stage);
  if (filters.startedFrom) add("started_at >= ?", filters.startedFrom);
  if (filters.startedTo) add("started_at <= ?", filters.startedTo);
  if (filters.slaStatus) {
    values.push(filters.slaStatus, filters.slaStatus);
    conditions.push(`(technical_sla_status = $${values.length - 1} OR business_sla_status = $${values.length})`);
  }

  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await client.query<ExecutionRowWire>(
    `SELECT * FROM operational_executions ${where} ORDER BY started_at DESC NULLS LAST, created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map(fromWire), hasMore };
}

export interface VersionExecutionStats {
  productVersion: string;
  distinctSubscribers: number;
  executionCount: number;
  failureCount: number;
  slaFailCount: number;
}

// Phase 10 §58/§61: per-version rollup used for adoption/deprecated-usage
// metrics. `distinct_subscribers` (recent, correlated executions with a
// subscription_id) is the adoption proxy this service already has data
// for, without a new bulk-listing integration into subscription-service —
// documented as such, not literally "every current subscription."
export async function aggregateExecutionsByVersion(
  client: pg.Pool | pg.PoolClient,
  dataProductId: string,
  sinceDate: Date,
): Promise<VersionExecutionStats[]> {
  const { rows } = await client.query<{
    product_version: string;
    distinct_subscribers: string;
    execution_count: string;
    failure_count: string;
    sla_fail_count: string;
  }>(
    `SELECT
       product_version,
       COUNT(DISTINCT subscription_id) FILTER (WHERE subscription_id IS NOT NULL) AS distinct_subscribers,
       COUNT(*) AS execution_count,
       COUNT(*) FILTER (WHERE overall_status = 'FAILED') AS failure_count,
       COUNT(*) FILTER (WHERE technical_sla_status = 'FAIL' OR business_sla_status = 'FAIL') AS sla_fail_count
     FROM operational_executions
     WHERE data_product_id = $1 AND created_at >= $2
     GROUP BY product_version`,
    [dataProductId, sinceDate],
  );
  return rows.map((r) => ({
    productVersion: r.product_version,
    distinctSubscribers: Number(r.distinct_subscribers),
    executionCount: Number(r.execution_count),
    failureCount: Number(r.failure_count),
    slaFailCount: Number(r.sla_fail_count),
  }));
}
