import type {
  AdminAlertRow,
  AdminExecutionRow,
  AdminIncidentRow,
  AdminProductHealthRow,
  ObservabilityAdminService,
} from "@/services/interfaces";
import {
  getProductHealthInternal,
  listAlertsInternal,
  listExecutionsInternal,
  listIncidentsInternal,
  ObservabilityServiceError,
} from "@/lib/observability-service/client";

export class ObservabilityAdminApiService implements ObservabilityAdminService {
  async listRecentExecutions(params: { dataProductId?: string; tenantId?: string; status?: string; limit?: number } = {}) {
    try {
      const { items } = await listExecutionsInternal(params);
      const rows: AdminExecutionRow[] = items.map((e) => ({
        executionId: e.execution_id,
        organizationId: e.organization_id,
        tenantId: e.tenant_id,
        dataProductId: e.data_product_id,
        productVersion: e.product_version,
        currentStage: e.current_stage,
        overallStatus: e.overall_status,
        technicalSlaStatus: e.technical_sla_status,
        businessSlaStatus: e.business_sla_status,
        healthStatus: e.health_status,
        startedAt: e.started_at,
        completedAt: e.completed_at,
      }));
      return { available: true, items: rows };
    } catch (err) {
      if (err instanceof ObservabilityServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async listAlerts(params: { state?: string; tenantId?: string } = {}) {
    try {
      const { items } = await listAlertsInternal(params);
      const rows: AdminAlertRow[] = items.map((a) => ({
        alertId: a.alert_id,
        alertType: a.alert_type,
        severity: a.severity,
        state: a.state,
        dataProductId: a.data_product_id,
        productVersion: a.product_version,
        executionId: a.execution_id,
        title: a.title,
        description: a.description,
        openedAt: a.opened_at,
        resolvedAt: a.resolved_at,
        incidentId: a.incident_id,
      }));
      return { available: true, items: rows };
    } catch (err) {
      if (err instanceof ObservabilityServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async listIncidents(params: { state?: string; tenantId?: string } = {}) {
    try {
      const { items } = await listIncidentsInternal(params);
      const rows: AdminIncidentRow[] = items.map((i) => ({
        incidentId: i.incident_id,
        dataProductId: i.data_product_id,
        productVersion: i.product_version,
        title: i.title,
        severity: i.severity,
        state: i.state,
        openedAt: i.opened_at,
        resolvedAt: i.resolved_at,
      }));
      return { available: true, items: rows };
    } catch (err) {
      if (err instanceof ObservabilityServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async getProductHealth(dataProductId: string, version?: string): Promise<AdminProductHealthRow | null> {
    try {
      const health = await getProductHealthInternal(dataProductId, { version });
      return {
        dataProductId,
        status: health.status,
        score: health.score,
        componentScores: health.component_scores,
      };
    } catch (err) {
      if (err instanceof ObservabilityServiceError && (err.code === "NOT_CONFIGURED" || err.status === 404)) {
        return null;
      }
      throw err;
    }
  }
}
