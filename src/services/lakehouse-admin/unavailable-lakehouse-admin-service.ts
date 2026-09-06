import type { LakehouseAdminService } from "@/services/interfaces";

/**
 * Fallback when EXCHANGE_SERVICE_URL and/or LAKEHOUSE_SERVICE_URL are unset
 * -- keeps /admin/lakehouse non-crashing, same opt-in pattern as the rest
 * of the exchange-service integration.
 */
export class UnavailableLakehouseAdminService implements LakehouseAdminService {
  async listRecentExchangesWithIngestionStatus() {
    return { available: false, items: [] };
  }

  async triggerIngestion(): Promise<never> {
    throw new Error(
      "Lakehouse admin integration is not configured (EXCHANGE_SERVICE_URL / LAKEHOUSE_SERVICE_URL).",
    );
  }

  async listPipelineRuns() {
    return { available: false, items: [] };
  }

  async getPipelineRunDetail() {
    return null;
  }

  async triggerBronzeToSilver(): Promise<never> {
    throw new Error("Lakehouse admin integration is not configured (LAKEHOUSE_SERVICE_URL).");
  }

  async triggerSilverToGold(): Promise<never> {
    throw new Error("Lakehouse admin integration is not configured (LAKEHOUSE_SERVICE_URL).");
  }

  async listDataProducts() {
    return { available: false, items: [] };
  }

  async getDataProductRows() {
    return [];
  }
}
