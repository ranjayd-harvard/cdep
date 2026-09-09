// Spec §27/§36/§71 — everything Phase 7 needs to eventually construct a
// PublicationRequest. Deliberately excludes next_run_at/last_run_at/
// missed_run/scheduler-lock/job-ownership/retry fields (spec §27, invariant
// #12/#13) — due-time evaluation belongs entirely to Phase 7.
export interface DeliveryContextDTO {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: string;
  versionPolicy: {
    type: string;
    value: string | null;
  };
  resolvedProductVersion: {
    version: string;
    lifecycleStatus: string;
  } | null;
  delivery: {
    method: string;
    format: string | null;
    frequency: string;
    deliveryTime: string | null;
    timezone: string | null;
    retentionDays: number | null;
    apiProfile: string | null;
    dayOfWeek: string | null;
    cronExpression: string | null;
  };
}
