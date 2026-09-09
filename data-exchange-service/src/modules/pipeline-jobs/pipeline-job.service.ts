import { AppError } from "../../common/errors/app-error.js";
import { generatePipelineJobId } from "../../common/ids/id-generator.js";
import { pool } from "../../database/pool.js";
import { runPipelineJobById } from "../../pipeline-worker/pipeline-worker.service.js";
import { getDataProduct } from "../data-products/data-product.repository.js";
import { createPipelineJob, getPipelineJobById, listPipelineJobs as listPipelineJobsRepo, type PipelineJobRow } from "./pipeline-job.repository.js";
import type { CreatePipelineJobBody } from "./pipeline-job.schemas.js";

async function assertTenantExists(organizationId: string, tenantId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM exchange.tenants WHERE tenant_id = $1 AND organization_id = $2`,
    [tenantId, organizationId],
  );
  if (rows.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Unknown organizationId/tenantId combination.");
  }
}

export interface EnqueuePipelineJobResult {
  jobId: string;
  status: string;
}

// Durable stand-in for a direct trigger: inserted here as PENDING, picked up
// later by this service's own pipeline worker (see ../../pipeline-worker/)
// on its own schedule -- deliberately decoupled from the upload request
// that enqueues it, so uploads never block on (or fail because of) how
// long the real Bronze->Silver->Gold->Publish chain takes to run.
export async function enqueuePipelineJob(body: CreatePipelineJobBody): Promise<EnqueuePipelineJobResult> {
  await assertTenantExists(body.organizationId, body.tenantId);

  const dataProduct = await getDataProduct(body.dataProductId);
  if (!dataProduct || dataProduct.status !== "ACTIVE") {
    throw new AppError("DATA_PRODUCT_NOT_FOUND", "The requested data product was not found.");
  }

  const job = await createPipelineJob({
    jobId: generatePipelineJobId(),
    organizationId: body.organizationId,
    tenantId: body.tenantId,
    dataProductId: body.dataProductId,
    sourceExchangeId: body.exchangeId,
  });

  return { jobId: job.job_id, status: job.status };
}

// Customer/admin-facing DTO mapping, same shape/precedent as
// exchange.service.ts's listExchangesInternal.
export interface PipelineJobDTO {
  jobId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  sourceExchangeId: string;
  outboundExchangeId: string | null;
  status: string;
  currentStage: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPipelineJobDTO(row: PipelineJobRow): PipelineJobDTO {
  return {
    jobId: row.job_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    sourceExchangeId: row.source_exchange_id,
    outboundExchangeId: row.outbound_exchange_id,
    status: row.status,
    currentStage: row.current_stage,
    attempts: row.attempts,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// Backs the admin "Pipeline Queue" list -- see
// docs/pipeline-job-queue-design.md's "Deferred / explicitly out of scope"
// section, which called this out as not yet built.
export async function listPipelineJobs(status?: string, limit?: number): Promise<PipelineJobDTO[]> {
  const rows = await listPipelineJobsRepo({ status }, limit);
  return rows.map(toPipelineJobDTO);
}

// Admin-triggered "Run" (for a PENDING job, instead of waiting for the next
// poll tick) / "Re-enqueue" (for a FAILED or SUCCEEDED job) action -- both
// collapse to the same operation: atomically claim the job and run the
// chain immediately. Throws PIPELINE_JOB_NOT_FOUND if the id is unknown,
// CONFLICT if it's already RUNNING (e.g. the poll loop claimed it first).
export async function runPipelineJobNow(jobId: string): Promise<PipelineJobDTO> {
  const existing = await getPipelineJobById(jobId);
  if (!existing) {
    throw new AppError("PIPELINE_JOB_NOT_FOUND", "The requested pipeline job was not found.");
  }
  if (existing.status === "RUNNING") {
    throw new AppError("CONFLICT", "Pipeline job is already running.");
  }

  const result = await runPipelineJobById(jobId);
  if (!result) {
    throw new AppError("CONFLICT", "Pipeline job could not be claimed (it may already be running).");
  }
  return toPipelineJobDTO(result);
}
