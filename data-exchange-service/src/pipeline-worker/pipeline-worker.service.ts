import { logger } from "../common/logger/logger.js";
import {
  claimNextPendingJob,
  getPipelineJobById,
  markPipelineJobFailed,
  markPipelineJobSucceeded,
  requeueAndClaimJob,
  updatePipelineJobStage,
  type PipelineJobRow,
} from "../modules/pipeline-jobs/pipeline-job.repository.js";
import { triggerBronzeToSilver, triggerIngestion, triggerSilverToGold } from "./lakehouse-client.js";
import { triggerPublish } from "./publication-client.js";

// Terminal status values from the real Python services (confirmed in
// data-lakehouse's ingestion/status.py and pipelines/pipeline_status.py,
// and data-publication-service's models/publication.py) -- a "soft" failure
// still comes back as a normal 200 response with one of these strings, not
// necessarily a thrown error.
const PIPELINE_SUCCESS_STATUSES = new Set(["COMPLETED", "SKIPPED_DUPLICATE"]);
const PUBLISH_SUCCESS_STATUSES = new Set(["READY", "SKIPPED_DUPLICATE"]);

type Stage = "INGEST" | "BRONZE_TO_SILVER" | "SILVER_TO_GOLD" | "PUBLISH";

// Runs the real Bronze->Silver->Gold->Publish chain for one already-claimed
// (RUNNING) job, calling the exact same internal endpoints
// /admin/lakehouse/pipelines already calls manually from cdep
// (src/lib/lakehouse-service/client.ts and src/lib/publication-service/client.ts
// there) -- this is that same chain, automated and durable instead of
// admin-triggered. Single-attempt: a failure marks the job FAILED for
// manual inspection rather than retrying. Shared by both the poll loop
// (below) and an admin "Run"/"Re-enqueue" action (runPipelineJobById) --
// the two differ only in *how* the job got into RUNNING, not in how it's
// processed once there.
async function runClaimedJob(job: PipelineJobRow): Promise<void> {
  let stage: Stage = "INGEST";
  try {
    stage = "INGEST";
    await updatePipelineJobStage(job.job_id, stage);
    const ingestion = await triggerIngestion(job.source_exchange_id);
    if (!PIPELINE_SUCCESS_STATUSES.has(ingestion.status)) {
      await markPipelineJobFailed(job.job_id, stage, ingestion.error_code, ingestion.error_message ?? "Ingestion failed.");
      return;
    }

    stage = "BRONZE_TO_SILVER";
    await updatePipelineJobStage(job.job_id, stage);
    const silver = await triggerBronzeToSilver(ingestion.ingestion_id);
    if (!PIPELINE_SUCCESS_STATUSES.has(silver.status)) {
      await markPipelineJobFailed(job.job_id, stage, silver.error_code, silver.error_message ?? "Bronze->Silver failed.");
      return;
    }

    stage = "SILVER_TO_GOLD";
    await updatePipelineJobStage(job.job_id, stage);
    const [gold] = await triggerSilverToGold(silver.pipeline_run_id);
    if (!gold || !PIPELINE_SUCCESS_STATUSES.has(gold.status)) {
      await markPipelineJobFailed(
        job.job_id,
        stage,
        gold?.error_code ?? null,
        gold?.error_message ?? "Silver->Gold failed.",
      );
      return;
    }

    stage = "PUBLISH";
    await updatePipelineJobStage(job.job_id, stage);
    const publication = await triggerPublish(gold.pipeline_run_id);
    if (!PUBLISH_SUCCESS_STATUSES.has(publication.status) || !publication.outbound_exchange_id) {
      await markPipelineJobFailed(job.job_id, stage, publication.error_code, publication.error_message ?? "Publish failed.");
      return;
    }

    await markPipelineJobSucceeded(job.job_id, publication.outbound_exchange_id);
  } catch (err) {
    logger.error({ err, jobId: job.job_id, stage }, "Pipeline job failed with an unexpected error");
    await markPipelineJobFailed(
      job.job_id,
      stage,
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "Unexpected error.",
    );
  }
}

// Returns true if a job was claimed and processed (whether it ultimately
// succeeded or failed), false if the queue was empty.
export async function processNextPipelineJob(): Promise<boolean> {
  const job = await claimNextPendingJob();
  if (!job) return false;
  await runClaimedJob(job);
  return true;
}

// Admin-triggered counterpart to the poll loop above: (re)claims one
// specific job regardless of which queue position it's in (PENDING, or a
// terminal FAILED/SUCCEEDED being re-enqueued) and runs it immediately
// instead of waiting for the next poll tick. Returns the job's final row,
// or null if it doesn't exist or is already RUNNING (e.g. the poll loop
// picked it up first).
export async function runPipelineJobById(jobId: string): Promise<PipelineJobRow | null> {
  const job = await requeueAndClaimJob(jobId);
  if (!job) return null;
  await runClaimedJob(job);
  return (await getPipelineJobById(jobId)) ?? job;
}
