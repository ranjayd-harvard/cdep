/**
 * Superadmin-only, cross-tenant surface backing `/admin/observability` —
 * data-platform-observability-service's operational read model (Phase 9).
 * Deliberately separate from any customer-facing interface, same
 * precedent as `LakehouseAdminService`.
 */
export interface AdminExecutionRow {
  executionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  currentStage: string | null;
  overallStatus: string;
  technicalSlaStatus: string;
  businessSlaStatus: string;
  healthStatus: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminAlertRow {
  alertId: string;
  alertType: string;
  severity: string;
  state: string;
  dataProductId: string;
  productVersion: string;
  executionId: string | null;
  title: string;
  description: string | null;
  openedAt: string;
  resolvedAt: string | null;
  incidentId: string | null;
}

export interface AdminIncidentRow {
  incidentId: string;
  dataProductId: string;
  productVersion: string;
  title: string;
  severity: string;
  state: string;
  openedAt: string;
  resolvedAt: string | null;
}

export interface AdminProductHealthRow {
  dataProductId: string;
  status: string;
  score: number | null;
  componentScores: Record<string, number> | null;
}

export interface ObservabilityAdminService {
  listRecentExecutions(params?: { dataProductId?: string; tenantId?: string; status?: string; limit?: number }): Promise<{
    available: boolean;
    items: AdminExecutionRow[];
  }>;
  listAlerts(params?: { state?: string; tenantId?: string }): Promise<{ available: boolean; items: AdminAlertRow[] }>;
  listIncidents(params?: { state?: string; tenantId?: string }): Promise<{ available: boolean; items: AdminIncidentRow[] }>;
  getProductHealth(dataProductId: string, version?: string): Promise<AdminProductHealthRow | null>;
}
