import type pg from "pg";
import { pool } from "../../database/pool.js";

export interface PipelineJobRow {
  job_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  source_exchange_id: string;
  outbound_exchange_id: string | null;
  status: string;
  current_stage: string | null;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function createPipelineJob(
  input: {
    jobId: string;
    organizationId: string;
    tenantId: string;
    dataProductId: string;
    sourceExchangeId: string;
  },
  client: pg.PoolClient | pg.Pool = pool,
): Promise<PipelineJobRow> {
  const { rows } = await client.query<PipelineJobRow>(
    `INSERT INTO exchange.pipeline_jobs
       (job_id, organization_id, tenant_id, data_product_id, source_exchange_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', now(), now())
     RETURNING *`,
    [input.jobId, input.organizationId, input.tenantId, input.dataProductId, input.sourceExchangeId],
  );
  return rows[0]!;
}

// Backs the admin "Pipeline Queue" list -- most-recent-first, optionally
// filtered by status, capped by limit. No pagination cursor: this is a
// dashboard-style view, not a customer-facing paginated list.
export async function listPipelineJobs(
  filter: { status?: string } = {},
  limit = 100,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<PipelineJobRow[]> {
  const { rows } = await client.query<PipelineJobRow>(
    `SELECT * FROM exchange.pipeline_jobs
     WHERE ($1::varchar IS NULL OR status = $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [filter.status ?? null, limit],
  );
  return rows;
}

export async function getPipelineJobById(
  jobId: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<PipelineJobRow | null> {
  const { rows } = await client.query<PipelineJobRow>(`SELECT * FROM exchange.pipeline_jobs WHERE job_id = $1`, [
    jobId,
  ]);
  return rows[0] ?? null;
}

// Admin-triggered "Run" / "Re-enqueue" action: atomically (re)claims a job
// that isn't currently RUNNING and flips it straight to RUNNING, clearing
// any prior terminal state -- one statement covers both "run this PENDING
// job now instead of waiting for the next poll" and "re-enqueue this
// FAILED/SUCCEEDED job" (the doc at ../../../docs/pipeline-job-queue-design.md
// called the latter out as a deferred follow-up; this is it). Returns null
// if the job doesn't exist or is already RUNNING, so the caller can tell
// "nothing to do" apart from "ran it".
export async function requeueAndClaimJob(
  jobId: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<PipelineJobRow | null> {
  const { rows } = await client.query<PipelineJobRow>(
    `UPDATE exchange.pipeline_jobs
     SET status = 'RUNNING', current_stage = NULL, error_code = NULL, error_message = NULL,
         outbound_exchange_id = NULL, started_at = now(), completed_at = NULL,
         updated_at = now(), attempts = attempts + 1
     WHERE job_id = $1 AND status IN ('PENDING', 'FAILED', 'SUCCEEDED')
     RETURNING *`,
    [jobId],
  );
  return rows[0] ?? null;
}

// Claims the oldest PENDING job and flips it to RUNNING in one atomic
// statement (FOR UPDATE SKIP LOCKED), so more than one worker process could
// run concurrently without double-processing the same job. Returns null
// when there is nothing to do.
export async function claimNextPendingJob(client: pg.PoolClient | pg.Pool = pool): Promise<PipelineJobRow | null> {
  const { rows } = await client.query<PipelineJobRow>(
    `WITH next_job AS (
       SELECT job_id FROM exchange.pipeline_jobs
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE exchange.pipeline_jobs
     SET status = 'RUNNING', started_at = now(), updated_at = now(), attempts = attempts + 1
     WHERE job_id = (SELECT job_id FROM next_job)
     RETURNING *`,
  );
  return rows[0] ?? null;
}

export async function updatePipelineJobStage(
  jobId: string,
  stage: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<void> {
  await client.query(`UPDATE exchange.pipeline_jobs SET current_stage = $2, updated_at = now() WHERE job_id = $1`, [
    jobId,
    stage,
  ]);
}

export async function markPipelineJobSucceeded(
  jobId: string,
  outboundExchangeId: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<void> {
  await client.query(
    `UPDATE exchange.pipeline_jobs
     SET status = 'SUCCEEDED', outbound_exchange_id = $2, current_stage = NULL,
         error_code = NULL, error_message = NULL, completed_at = now(), updated_at = now()
     WHERE job_id = $1`,
    [jobId, outboundExchangeId],
  );
}

export async function markPipelineJobFailed(
  jobId: string,
  stage: string,
  errorCode: string | null,
  errorMessage: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<void> {
  await client.query(
    `UPDATE exchange.pipeline_jobs
     SET status = 'FAILED', current_stage = $2, error_code = $3, error_message = $4,
         completed_at = now(), updated_at = now()
     WHERE job_id = $1`,
    [jobId, stage, errorCode, errorMessage],
  );
}
