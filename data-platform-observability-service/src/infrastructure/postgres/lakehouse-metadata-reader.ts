import { lakehousePool } from "../../database/lakehouse-pool.js";
import { logger } from "../../common/logger/logger.js";

// Direct read-only reads against data-lakehouse's own `lakehouse` schema —
// the real precedent data-publication-service already uses for the same
// database (see PUBLICATION_LAKEHOUSE_METADATA_DB_URL). This service issues
// SELECT only, never a write, against a sibling's database.

export interface IngestionRunRow {
  ingestionId: string;
  exchangeId: string | null;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  sourceRecordCount: number | null;
  bronzeRecordCount: number | null;
  rejectedRecordCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface PipelineRunRow {
  pipelineRunId: string;
  pipelineType: "BRONZE_TO_SILVER" | "SILVER_TO_GOLD";
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  sourceExchangeId: string | null;
  sourceIngestionId: string | null;
  sourcePipelineRunId: string | null;
  contractVersion: string | null;
  status: string;
  inputRecordCount: number | null;
  outputRecordCount: number | null;
  rejectedRecordCount: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface QualityResultRow {
  pipelineRunId: string;
  layer: "SILVER" | "GOLD";
  tableName: string;
  ruleName: string;
  severity: string;
  totalCount: number | null;
  failedCount: number | null;
  failurePercentage: number | null;
  passed: boolean;
  evaluatedAt: Date;
}

export async function listIngestionRunsSince(since: Date, limit = 500): Promise<IngestionRunRow[]> {
  if (!lakehousePool) return [];
  try {
    const { rows } = await lakehousePool.query(
      `SELECT ingestion_id, exchange_id, organization_id, tenant_id, data_product_id, status,
              started_at, completed_at, source_record_count, bronze_record_count, rejected_record_count,
              error_code, error_message, created_at
       FROM lakehouse.ingestion_runs
       WHERE created_at > $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [since, limit],
    );
    return rows.map((r) => ({
      ingestionId: r.ingestion_id,
      exchangeId: r.exchange_id,
      organizationId: r.organization_id,
      tenantId: r.tenant_id,
      dataProductId: r.data_product_id,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      sourceRecordCount: r.source_record_count === null ? null : Number(r.source_record_count),
      bronzeRecordCount: r.bronze_record_count === null ? null : Number(r.bronze_record_count),
      rejectedRecordCount: r.rejected_record_count === null ? null : Number(r.rejected_record_count),
      errorCode: r.error_code,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    }));
  } catch (err) {
    logger.warn({ err }, "lakehouse.ingestion_runs read failed");
    return [];
  }
}

export async function listPipelineRunsSince(since: Date, limit = 500): Promise<PipelineRunRow[]> {
  if (!lakehousePool) return [];
  try {
    const { rows } = await lakehousePool.query(
      `SELECT pipeline_run_id, pipeline_type, organization_id, tenant_id, data_product_id,
              source_exchange_id, source_ingestion_id, source_pipeline_run_id, contract_version, status,
              input_record_count, output_record_count, rejected_record_count,
              started_at, completed_at, error_code, error_message, created_at
       FROM lakehouse.pipeline_runs
       WHERE created_at > $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [since, limit],
    );
    return rows.map((r) => ({
      pipelineRunId: r.pipeline_run_id,
      pipelineType: r.pipeline_type,
      organizationId: r.organization_id,
      tenantId: r.tenant_id,
      dataProductId: r.data_product_id,
      sourceExchangeId: r.source_exchange_id,
      sourceIngestionId: r.source_ingestion_id,
      sourcePipelineRunId: r.source_pipeline_run_id,
      contractVersion: r.contract_version,
      status: r.status,
      inputRecordCount: r.input_record_count === null ? null : Number(r.input_record_count),
      outputRecordCount: r.output_record_count === null ? null : Number(r.output_record_count),
      rejectedRecordCount: r.rejected_record_count === null ? null : Number(r.rejected_record_count),
      startedAt: r.started_at,
      completedAt: r.completed_at,
      errorCode: r.error_code,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    }));
  } catch (err) {
    logger.warn({ err }, "lakehouse.pipeline_runs read failed");
    return [];
  }
}

export async function listQualityResultsSince(since: Date, limit = 500): Promise<QualityResultRow[]> {
  if (!lakehousePool) return [];
  try {
    const { rows } = await lakehousePool.query(
      `SELECT pipeline_run_id, layer, table_name, rule_name, severity, total_count, failed_count,
              failure_percentage, passed, evaluated_at
       FROM lakehouse.quality_results
       WHERE evaluated_at > $1
       ORDER BY evaluated_at ASC
       LIMIT $2`,
      [since, limit],
    );
    return rows.map((r) => ({
      pipelineRunId: r.pipeline_run_id,
      layer: r.layer,
      tableName: r.table_name,
      ruleName: r.rule_name,
      severity: r.severity,
      totalCount: r.total_count === null ? null : Number(r.total_count),
      failedCount: r.failed_count === null ? null : Number(r.failed_count),
      failurePercentage: r.failure_percentage === null ? null : Number(r.failure_percentage),
      passed: r.passed,
      evaluatedAt: r.evaluated_at,
    }));
  } catch (err) {
    logger.warn({ err }, "lakehouse.quality_results read failed");
    return [];
  }
}
