import type { MaintenanceWindowScope } from "../../config/constants.js";

export interface MaintenanceWindowView {
  scope: MaintenanceWindowScope;
  scopeValue: string | null;
  startsAt: Date;
  endsAt: Date;
}

export interface SuppressionScope {
  serviceName: string | null;
  dataProductId: string;
  productVersion: string;
  tenantId: string;
}

function scopeMatches(window: MaintenanceWindowView, scope: SuppressionScope): boolean {
  switch (window.scope) {
    case "PLATFORM":
      return true;
    case "SERVICE":
      return window.scopeValue === scope.serviceName;
    case "PRODUCT":
      return window.scopeValue === scope.dataProductId;
    case "PRODUCT_VERSION":
      return window.scopeValue === `${scope.dataProductId}:${scope.productVersion}`;
    case "TENANT":
      return window.scopeValue === scope.tenantId;
    default:
      return false;
  }
}

// Checks whether an alert about to be opened falls inside any active
// maintenance window (spec section 23). A suppressed rule-fire is still
// dedupe'd/logged as an operational_event by the caller — only its alert
// state is forced to SUPPRESSED instead of OPEN.
export function isSuppressedByMaintenanceWindow(
  windows: readonly MaintenanceWindowView[],
  scope: SuppressionScope,
  now: Date,
): boolean {
  return windows.some((w) => now >= w.startsAt && now <= w.endsAt && scopeMatches(w, scope));
}

// An already-existing alert can also carry its own suppressed_until
// (spec section 22's "configurable suppression windows") independent of any
// maintenance window — e.g. an operator explicitly silenced a noisy rule.
export function isSuppressedUntil(suppressedUntil: Date | null, now: Date): boolean {
  return suppressedUntil !== null && now < suppressedUntil;
}
