import type { PublicationAdminService } from "@/services/interfaces";

/**
 * Fallback when PUBLICATION_SERVICE_URL is unset -- keeps the "Publish
 * Gold Product" panel non-crashing, same opt-in pattern as
 * UnavailableLakehouseAdminService.
 */
export class UnavailablePublicationAdminService implements PublicationAdminService {
  async listPublications() {
    return { available: false, items: [] };
  }

  async getPublicationDetail() {
    return null;
  }

  async triggerPublish(): Promise<never> {
    throw new Error("Publication Service integration is not configured (PUBLICATION_SERVICE_URL).");
  }
}
