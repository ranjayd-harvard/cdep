/**
 * Superadmin-only surface over data-exchange-service's `exchange.pipeline_jobs`
 * queue -- backs the "Pipeline Queue" tab on `/admin/lakehouse`. Deliberately
 * a separate interface from `LakehouseAdminService`/`PublicationAdminService`
 * (same precedent those two already set): a pipeline job is a
 * data-exchange-service-owned record that merely *drives* calls into
 * data-lakehouse and data-publication-service, not a resource either of
 * those services exposes itself. See docs/pipeline-job-queue-design.md's
 * "Deferred / explicitly out of scope" section -- this fills the "No admin
 * UI listing pipeline_jobs" / "manual re-enqueue via a future admin action"
 * gaps called out there.
 */
export interface PipelineJobRow {
  jobId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  sourceExchangeId: string;
  outboundExchangeId: string | null;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  currentStage: "INGEST" | "BRONZE_TO_SILVER" | "SILVER_TO_GOLD" | "PUBLISH" | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunPipelineJobResult {
  ok: boolean;
  job?: PipelineJobRow;
  errorCode?: string;
  errorMessage?: string;
}

export interface PipelineJobAdminService {
  listPipelineJobs(params?: { status?: string; limit?: number }): Promise<{
    available: boolean;
    items: PipelineJobRow[];
  }>;
  /** Runs a PENDING job immediately, or re-enqueues+runs a FAILED/SUCCEEDED one. */
  runPipelineJob(jobId: string): Promise<RunPipelineJobResult>;
}
