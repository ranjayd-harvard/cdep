export interface AlertForCorrelation {
  alertId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  openedAt: Date;
  incidentId: string | null;
}

// Lightweight grouping (spec section 24) — deliberately not a full ITSM
// model. Alerts sharing (tenant, product, version) opened within
// windowMinutes of each other should link into one incident. Returns the
// existing incident to reuse, if any of the candidate alerts already
// belongs to one, so a fast-follow alert extends the same incident rather
// than starting a new one.
export function findIncidentToJoin(
  newAlert: Pick<AlertForCorrelation, "tenantId" | "dataProductId" | "productVersion" | "openedAt">,
  recentAlerts: readonly AlertForCorrelation[],
  windowMinutes: number,
): string | null {
  const windowMs = windowMinutes * 60_000;
  const candidates = recentAlerts.filter(
    (a) =>
      a.tenantId === newAlert.tenantId &&
      a.dataProductId === newAlert.dataProductId &&
      a.productVersion === newAlert.productVersion &&
      Math.abs(a.openedAt.getTime() - newAlert.openedAt.getTime()) <= windowMs,
  );

  const existingIncident = candidates.find((a) => a.incidentId !== null);
  return existingIncident?.incidentId ?? null;
}
