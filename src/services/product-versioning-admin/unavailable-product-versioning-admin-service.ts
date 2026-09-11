import type { AdminActionResult, ProductVersioningAdminService } from "@/services/interfaces";

/**
 * Fallback when CATALOG_SERVICE_URL is unset — keeps /admin/catalog
 * non-crashing, same opt-in pattern as the rest of the sibling-service
 * integrations.
 */
const NOT_CONFIGURED: AdminActionResult = { ok: false, errorCode: "NOT_CONFIGURED", errorMessage: "CATALOG_SERVICE_URL is not set." };

export class UnavailableProductVersioningAdminService implements ProductVersioningAdminService {
  async listProducts() {
    return { available: false, items: [] };
  }
  async listVersions() {
    return { available: false, items: [] };
  }
  async activateVersion() {
    return NOT_CONFIGURED;
  }
  async deprecateVersion() {
    return NOT_CONFIGURED;
  }
  async retireVersion() {
    return NOT_CONFIGURED;
  }
  async rollbackVersion() {
    return NOT_CONFIGURED;
  }
  async approveVersion() {
    return NOT_CONFIGURED;
  }
  async grantBetaOptIn() {
    return NOT_CONFIGURED;
  }
  async getImpact() {
    return null;
  }
  async listMigrations() {
    return { available: false, items: [] };
  }
  async createMigration() {
    return NOT_CONFIGURED;
  }
  async executeMigration() {
    return NOT_CONFIGURED;
  }
}
