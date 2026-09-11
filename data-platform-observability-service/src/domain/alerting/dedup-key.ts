import type { AlertType } from "../../config/constants.js";

// Deterministic dedup key (spec section 22): tenant + product + version +
// alert_type + execution/window. Its DB UNIQUE constraint (migrations/
// 008_alerts.sql) is what turns a repeated rule-fire into an UPSERT/reopen
// instead of a new row, so one broken execution can never fan out into
// hundreds of alerts. scopeKey is either an execution_id (execution-scoped
// rules) or a caller-computed time-window bucket (aggregate rules like
// API availability / no-data-received).
export function computeAlertDedupKey(params: {
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  alertType: AlertType;
  scopeKey: string;
}): string {
  return [params.tenantId, params.dataProductId, params.productVersion, params.alertType, params.scopeKey].join("|");
}
