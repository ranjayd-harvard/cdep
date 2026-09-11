import type pg from "pg";
import type { OperationalStage, SlaStatus, SlaType } from "../../config/constants.js";

export interface SlaEvaluationRow {
  slaEvaluationId: string;
  executionId: string;
  slaDefinitionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  slaType: SlaType;
  stage: OperationalStage | null;
  status: SlaStatus;
  targetValue: Record<string, unknown>;
  actualValue: Record<string, unknown>;
  breachDurationSeconds: number | null;
  evaluatedAt: Date;
}

function fromWire(row: any): SlaEvaluationRow {
  return {
    slaEvaluationId: row.sla_evaluation_id,
    executionId: row.execution_id,
    slaDefinitionId: row.sla_definition_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    productVersion: row.product_version,
    slaType: row.sla_type,
    stage: row.stage,
    status: row.status,
    targetValue: row.target_value,
    actualValue: row.actual_value,
    breachDurationSeconds: row.breach_duration_seconds,
    evaluatedAt: row.evaluated_at,
  };
}

// One row per (execution, sla_definition) — re-evaluating the same pair
// (e.g. a stage that was AT_RISK and later completes) updates the same row
// rather than duplicating it, matching migrations/007's UNIQUE constraint.
// History is never lost across a recovery: the row for a PASSing execution
// stays distinct from the row for an earlier FAILing one (different
// execution_id), so spec section 40's "do not erase history" holds by
// construction.
export async function upsertEvaluation(
  client: pg.Pool | pg.PoolClient,
  params: {
    slaEvaluationId: string;
    executionId: string;
    slaDefinitionId: string;
    organizationId: string;
    tenantId: string;
    dataProductId: string;
    productVersion: string;
    slaType: SlaType;
    stage: OperationalStage | null;
    status: SlaStatus;
    targetValue: Record<string, unknown>;
    actualValue: Record<string, unknown>;
    breachDurationSeconds: number | null;
  },
): Promise<SlaEvaluationRow> {
  const { rows } = await client.query(
    `INSERT INTO sla_evaluations
       (sla_evaluation_id, execution_id, sla_definition_id, organization_id, tenant_id, data_product_id,
        product_version, sla_type, stage, status, target_value, actual_value, breach_duration_seconds, evaluated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     ON CONFLICT (execution_id, sla_definition_id) DO UPDATE SET
       status = EXCLUDED.status,
       actual_value = EXCLUDED.actual_value,
       breach_duration_seconds = EXCLUDED.breach_duration_seconds,
       evaluated_at = now()
     RETURNING *`,
    [
      params.slaEvaluationId,
      params.executionId,
      params.slaDefinitionId,
      params.organizationId,
      params.tenantId,
      params.dataProductId,
      params.productVersion,
      params.slaType,
      params.stage,
      params.status,
      params.targetValue,
      params.actualValue,
      params.breachDurationSeconds,
    ],
  );
  return fromWire(rows[0]!);
}

export async function listEvaluationsForExecution(client: pg.Pool | pg.PoolClient, executionId: string): Promise<SlaEvaluationRow[]> {
  const { rows } = await client.query("SELECT * FROM sla_evaluations WHERE execution_id = $1 ORDER BY evaluated_at ASC", [executionId]);
  return rows.map(fromWire);
}

export interface SlaListFilters {
  tenantId?: string;
  dataProductId?: string;
  productVersion?: string;
  status?: SlaStatus;
  onlyActiveBreaches?: boolean;
  limit?: number;
}

export async function listEvaluations(client: pg.Pool | pg.PoolClient, filters: SlaListFilters): Promise<SlaEvaluationRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  function add(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  }
  if (filters.tenantId) add("tenant_id = ?", filters.tenantId);
  if (filters.dataProductId) add("data_product_id = ?", filters.dataProductId);
  if (filters.productVersion) add("product_version = ?", filters.productVersion);
  if (filters.status) add("status = ?", filters.status);
  if (filters.onlyActiveBreaches) conditions.push("status = 'FAIL'");

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 100, 500);
  const { rows } = await client.query(
    `SELECT * FROM sla_evaluations ${where} ORDER BY evaluated_at DESC LIMIT $${values.length + 1}`,
    [...values, limit],
  );
  return rows.map(fromWire);
}
