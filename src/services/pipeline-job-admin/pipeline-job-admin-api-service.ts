import type { PipelineJobAdminService, PipelineJobRow, RunPipelineJobResult } from "@/services/interfaces";
import {
  ExchangeServiceError,
  listPipelineJobsInternal,
  runPipelineJobInternal,
  type PipelineJobDTO,
} from "@/lib/exchange-service/client";

// data-exchange-service's DTO is already camelCase (see
// pipeline-job.service.ts's toPipelineJobDTO there) and its field names line
// up 1:1 with PipelineJobRow, so this is a type-narrowing pass-through
// rather than a real remap -- kept as an explicit function anyway, matching
// this codebase's precedent (toPipelineRunRow/toPublicationRunRow) of never
// trusting a cross-service DTO shape by implicit structural assignment.
function toPipelineJobRow(dto: PipelineJobDTO): PipelineJobRow {
  return {
    jobId: dto.jobId,
    organizationId: dto.organizationId,
    tenantId: dto.tenantId,
    dataProductId: dto.dataProductId,
    sourceExchangeId: dto.sourceExchangeId,
    outboundExchangeId: dto.outboundExchangeId,
    status: dto.status as PipelineJobRow["status"],
    currentStage: dto.currentStage as PipelineJobRow["currentStage"],
    attempts: dto.attempts,
    errorCode: dto.errorCode,
    errorMessage: dto.errorMessage,
    startedAt: dto.startedAt,
    completedAt: dto.completedAt,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

export class PipelineJobAdminApiService implements PipelineJobAdminService {
  async listPipelineJobs(params?: { status?: string; limit?: number }) {
    try {
      const { items } = await listPipelineJobsInternal(params);
      return { available: true, items: items.map(toPipelineJobRow) };
    } catch (err) {
      if (err instanceof ExchangeServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async runPipelineJob(jobId: string): Promise<RunPipelineJobResult> {
    try {
      const job = await runPipelineJobInternal(jobId);
      return { ok: job.status !== "FAILED", job: toPipelineJobRow(job) };
    } catch (err) {
      // A 404 (unknown job) or 409 (already running) is a client-fixable
      // precondition failure -- surface it as a non-throwing result so the
      // Server Action can show a flash message instead of a crash. Anything
      // else (5xx/network) is genuinely unexpected and should propagate.
      if (err instanceof ExchangeServiceError && (err.status === 404 || err.status === 409)) {
        return { ok: false, errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  }
}
