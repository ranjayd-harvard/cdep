import type pg from "pg";
import { env } from "../../config/env.js";
import {
  businessSlaBreached,
  deliveryLate,
  freshnessSlaBreached,
  ingestionFailed,
  pipelineFailed,
  pipelineStuck,
  publicationFailed,
  qualityThresholdBreached,
  repeatedRetries,
  type AlertCandidate,
} from "../../domain/alerting/alert-rules.js";
// apiAvailabilityBelowThreshold/noDataReceived are aggregate (not
// execution-scoped) rules — not wired into the per-execution pipeline in
// this pass (they need a periodic window evaluator, not a per-event one);
// exercised directly by src/tests/unit/alert-rules.test.ts.
import { computeAlertDedupKey } from "../../domain/alerting/dedup-key.js";
import { isSuppressedByMaintenanceWindow } from "../../domain/alerting/suppression.js";
import { detectStuckRun } from "../../domain/stuck-run-detector.js";
import { defaultStageTargetMinutes } from "../../config/env.js";
import { generateAlertId, generateIncidentId } from "../../common/ids/id-generator.js";
import { findExecutionById } from "../../infrastructure/persistence/execution.repository.js";
import { listStageRunsForExecution, type StageRunRow } from "../../infrastructure/persistence/stage-run.repository.js";
import { listEvaluationsForExecution } from "../../infrastructure/persistence/sla-evaluation.repository.js";
import { listActiveOrUpcomingWindows } from "../../infrastructure/persistence/maintenance-window.repository.js";
import {
  linkAlertToIncident,
  listAlerts,
  listRecentAlertsForScope,
  resolveAlert,
  upsertAlert,
  type AlertRow,
} from "../../infrastructure/persistence/alert.repository.js";
import { createIncident, linkAlert, resolveIncidentIfAllAlertsResolved } from "../../infrastructure/persistence/incident.repository.js";
import { findIncidentToJoin } from "../../domain/alerting/incident-correlator.js";
import type { AlertType } from "../../config/constants.js";
import { increment } from "../../telemetry/metrics-registry.js";

const EXECUTION_SCOPED_ALERT_TYPES: readonly AlertType[] = [
  "INGESTION_FAILED",
  "PIPELINE_FAILED",
  "PIPELINE_STUCK",
  "QUALITY_THRESHOLD_BREACHED",
  "PUBLICATION_FAILED",
  "DELIVERY_LATE",
  "FRESHNESS_SLA_BREACHED",
  "REPEATED_RETRIES",
  "BUSINESS_SLA_BREACHED",
];

function toStageRunView(row: StageRunRow) {
  return { stage: row.stage, status: row.status, attemptNumber: row.attemptNumber, startedAt: row.startedAt, completedAt: row.completedAt };
}

// Runs every execution-scoped alert rule (spec section 21) after an
// ingest() pass, applies dedup/suppression, links related alerts into
// incidents, and auto-resolves prior alerts for the same scope once a
// later execution recovers (spec section 40 — history is preserved, only
// the alert's state transitions, the row itself is never deleted).
export async function evaluateAlertsForExecution(client: pg.Pool | pg.PoolClient, executionId: string, now: Date): Promise<void> {
  const execution = await findExecutionById(client, executionId);
  if (!execution) return;

  const stageRunRows = await listStageRunsForExecution(client, executionId);
  const stageRuns = stageRunRows.map(toStageRunView);
  const evaluations = await listEvaluationsForExecution(client, executionId);
  const businessEvaluation = evaluations.find((e) => e.slaType === "BUSINESS");

  const candidates: AlertCandidate[] = [];

  const ingestion = ingestionFailed(stageRuns, executionId);
  if (ingestion) candidates.push(ingestion);

  const pipeline = pipelineFailed(stageRuns, executionId);
  if (pipeline) candidates.push(pipeline);

  for (const run of stageRunRows) {
    if (run.status !== "RUNNING" || !run.startedAt) continue;
    const thresholdMinutes = defaultStageTargetMinutes(run.stage) * 2 || env.STUCK_RUN_THRESHOLD_MINUTES_DEFAULT;
    const stuck = detectStuckRun({ stage: run.stage, status: run.status, startedAt: run.startedAt }, now, thresholdMinutes);
    const candidate = pipelineStuck({ stage: run.stage, stuck: stuck.stuck, elapsedMinutes: stuck.elapsedMinutes }, executionId);
    if (candidate) candidates.push(candidate);
  }

  const quality = qualityThresholdBreached(stageRuns, executionId);
  if (quality) candidates.push(quality);

  const publication = publicationFailed(stageRuns, executionId);
  if (publication) candidates.push(publication);

  const late = deliveryLate(stageRuns, executionId);
  if (late) candidates.push(late);

  const business = businessSlaBreached(execution.businessSlaStatus, executionId, businessEvaluation?.breachDurationSeconds ?? null);
  if (business) candidates.push(business);

  const freshness = freshnessSlaBreached(execution.technicalSlaStatus, executionId);
  if (freshness) candidates.push(freshness);

  const retryCount = stageRunRows.filter((r) => r.attemptNumber > 1 || r.status === "RETRYING").length;
  const retries = repeatedRetries(retryCount, executionId);
  if (retries) candidates.push(retries);

  const maintenanceWindows = await listActiveOrUpcomingWindows(client, now);

  for (const candidate of candidates) {
    const dedupKey = computeAlertDedupKey({
      tenantId: execution.tenantId,
      dataProductId: execution.dataProductId,
      productVersion: execution.productVersion,
      alertType: candidate.alertType,
      scopeKey: candidate.scopeKey,
    });

    const suppressed = isSuppressedByMaintenanceWindow(
      maintenanceWindows,
      { serviceName: null, dataProductId: execution.dataProductId, productVersion: execution.productVersion, tenantId: execution.tenantId },
      now,
    );

    const alert = await upsertAlert(client, {
      alertId: generateAlertId(),
      dedupKey,
      alertType: candidate.alertType,
      severity: candidate.severity,
      organizationId: execution.organizationId,
      tenantId: execution.tenantId,
      dataProductId: execution.dataProductId,
      productVersion: execution.productVersion,
      executionId,
      title: candidate.title,
      description: candidate.description,
      suppressed,
      suppressedUntil: suppressed ? new Date(now.getTime() + env.ALERT_SUPPRESSION_WINDOW_MINUTES * 60_000) : null,
    });

    if (!suppressed) {
      if (alert.state === "OPEN") increment("alert_open_total");
      await correlateIntoIncident(client, alert);
    }
  }

  if (execution.overallStatus === "SUCCEEDED" && execution.technicalSlaStatus !== "FAIL" && execution.businessSlaStatus !== "FAIL") {
    await autoResolveOnRecovery(client, execution.tenantId, execution.dataProductId, execution.productVersion, executionId);
  }
}

async function correlateIntoIncident(client: pg.Pool | pg.PoolClient, alert: AlertRow): Promise<void> {
  // Already linked (e.g. a repeated fire of an already-incident-linked
  // alert) — nothing further to do.
  if (alert.incidentId) return;

  const recent = await listRecentAlertsForScope(
    client,
    { tenantId: alert.tenantId, dataProductId: alert.dataProductId, productVersion: alert.productVersion },
    env.INCIDENT_CORRELATION_WINDOW_MINUTES,
  );

  const existingIncidentId = findIncidentToJoin(
    { tenantId: alert.tenantId, dataProductId: alert.dataProductId, productVersion: alert.productVersion, openedAt: alert.openedAt },
    recent.map((a) => ({
      alertId: a.alertId,
      tenantId: a.tenantId,
      dataProductId: a.dataProductId,
      productVersion: a.productVersion,
      openedAt: a.openedAt,
      incidentId: a.incidentId,
    })),
    env.INCIDENT_CORRELATION_WINDOW_MINUTES,
  );

  if (existingIncidentId) {
    await linkAlert(client, existingIncidentId, alert.alertId);
    await linkAlertToIncident(client, alert.alertId, existingIncidentId);
    return;
  }

  // Only CRITICAL alerts seed a new incident on their own — a lone WARNING
  // stays a plain alert until something more severe joins it (spec section
  // 24: deliberately not a full ITSM model).
  if (alert.severity !== "CRITICAL") return;

  const incident = await createIncident(client, {
    incidentId: generateIncidentId(),
    organizationId: alert.organizationId,
    tenantId: alert.tenantId,
    dataProductId: alert.dataProductId,
    productVersion: alert.productVersion,
    title: `${alert.dataProductId} ${alert.productVersion} operational incident`,
    severity: alert.severity,
  });
  await linkAlert(client, incident.incidentId, alert.alertId);
  await linkAlertToIncident(client, alert.alertId, incident.incidentId);
}

async function autoResolveOnRecovery(
  client: pg.Pool | pg.PoolClient,
  tenantId: string,
  dataProductId: string,
  productVersion: string,
  currentExecutionId: string,
): Promise<void> {
  const openAlerts = await listAlerts(client, { tenantId, dataProductId, state: "OPEN" });
  const acknowledgedAlerts = await listAlerts(client, { tenantId, dataProductId, state: "ACKNOWLEDGED" });

  const toResolve = [...openAlerts, ...acknowledgedAlerts].filter(
    (a) =>
      a.productVersion === productVersion &&
      a.executionId !== null &&
      a.executionId !== currentExecutionId &&
      EXECUTION_SCOPED_ALERT_TYPES.includes(a.alertType),
  );

  for (const alert of toResolve) {
    await resolveAlert(client, alert.alertId, "system:recovery");
    if (alert.incidentId) {
      await resolveIncidentIfAllAlertsResolved(client, alert.incidentId);
    }
  }
}
