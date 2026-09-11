import type pg from "pg";
import type { OperationalStage, OperationalStatus } from "../../config/constants.js";

export interface StageRunRow {
  stageRunId: string;
  executionId: string;
  stage: OperationalStage;
  status: OperationalStatus;
  sourceService: string;
  sourceEntityId: string | null;
  attemptNumber: number;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  errorCategory: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadataJson: Record<string, unknown>;
}

interface StageRunWire {
  stage_run_id: string;
  execution_id: string;
  stage: OperationalStage;
  status: OperationalStatus;
  source_service: string;
  source_entity_id: string | null;
  attempt_number: number;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: string | number | null;
  error_category: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata_json: Record<string, unknown>;
}

function fromWire(row: StageRunWire): StageRunRow {
  return {
    stageRunId: row.stage_run_id,
    executionId: row.execution_id,
    stage: row.stage,
    status: row.status,
    sourceService: row.source_service,
    sourceEntityId: row.source_entity_id,
    attemptNumber: row.attempt_number,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    errorCategory: row.error_category,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    metadataJson: row.metadata_json,
  };
}

// Upserts on (execution_id, stage, attempt_number) — a later event for the
// same stage/attempt (e.g. RUNNING -> SUCCEEDED) updates the same row
// rather than creating a duplicate, matching migrations/003's UNIQUE
// constraint.
export async function upsertStageRun(
  client: pg.Pool | pg.PoolClient,
  params: {
    stageRunId: string;
    executionId: string;
    stage: OperationalStage;
    status: OperationalStatus;
    sourceService: string;
    sourceEntityId: string | null;
    attemptNumber: number;
    startedAt: Date | null;
    completedAt: Date | null;
    durationMs: number | null;
    errorCategory: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    metadataJson: Record<string, unknown>;
  },
): Promise<StageRunRow> {
  const { rows } = await client.query<StageRunWire>(
    `INSERT INTO operational_stage_runs
       (stage_run_id, execution_id, stage, status, source_service, source_entity_id, attempt_number,
        started_at, completed_at, duration_ms, error_category, error_code, error_message, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (execution_id, stage, attempt_number) DO UPDATE SET
       status = EXCLUDED.status,
       source_entity_id = COALESCE(EXCLUDED.source_entity_id, operational_stage_runs.source_entity_id),
       started_at = COALESCE(operational_stage_runs.started_at, EXCLUDED.started_at),
       completed_at = COALESCE(EXCLUDED.completed_at, operational_stage_runs.completed_at),
       duration_ms = COALESCE(EXCLUDED.duration_ms, operational_stage_runs.duration_ms),
       error_category = COALESCE(EXCLUDED.error_category, operational_stage_runs.error_category),
       error_code = COALESCE(EXCLUDED.error_code, operational_stage_runs.error_code),
       error_message = COALESCE(EXCLUDED.error_message, operational_stage_runs.error_message),
       metadata_json = operational_stage_runs.metadata_json || EXCLUDED.metadata_json,
       updated_at = now()
     RETURNING *`,
    [
      params.stageRunId,
      params.executionId,
      params.stage,
      params.status,
      params.sourceService,
      params.sourceEntityId,
      params.attemptNumber,
      params.startedAt,
      params.completedAt,
      params.durationMs,
      params.errorCategory,
      params.errorCode,
      params.errorMessage,
      params.metadataJson,
    ],
  );
  return fromWire(rows[0]!);
}

export async function listStageRunsForExecution(client: pg.Pool | pg.PoolClient, executionId: string): Promise<StageRunRow[]> {
  const { rows } = await client.query<StageRunWire>(
    "SELECT * FROM operational_stage_runs WHERE execution_id = $1 ORDER BY started_at ASC NULLS LAST, stage ASC",
    [executionId],
  );
  return rows.map(fromWire);
}
