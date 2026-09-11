import type { ObservabilityAdminService } from "@/services/interfaces";

/**
 * Fallback when OBSERVABILITY_SERVICE_URL is unset — keeps
 * /admin/observability non-crashing, same opt-in pattern as the rest of
 * the sibling-service integrations.
 */
export class UnavailableObservabilityAdminService implements ObservabilityAdminService {
  async listRecentExecutions() {
    return { available: false, items: [] };
  }

  async listAlerts() {
    return { available: false, items: [] };
  }

  async listIncidents() {
    return { available: false, items: [] };
  }

  async getProductHealth() {
    return null;
  }
}
