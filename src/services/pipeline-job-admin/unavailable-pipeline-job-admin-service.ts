import type { PipelineJobAdminService } from "@/services/interfaces";

/**
 * Fallback when EXCHANGE_SERVICE_URL is unset -- keeps the "Pipeline Queue"
 * tab non-crashing, same opt-in pattern as UnavailableLakehouseAdminService /
 * UnavailablePublicationAdminService.
 */
export class UnavailablePipelineJobAdminService implements PipelineJobAdminService {
  async listPipelineJobs() {
    return { available: false, items: [] };
  }

  async runPipelineJob(): Promise<never> {
    throw new Error("Pipeline job admin integration is not configured (EXCHANGE_SERVICE_URL).");
  }
}
