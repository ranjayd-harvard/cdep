import { Badge, type BadgeColor } from "./badge";

const STATUS_MAP: Record<string, { label: string; color: BadgeColor }> = {
  ACTIVE: { label: "Active", color: "green" },
  COMPLETED: { label: "Completed", color: "green" },
  DEPRECATED: { label: "Deprecated", color: "gray" },
  REVOKED: { label: "Revoked", color: "red" },
  EXPIRED: { label: "Expired", color: "gray" },
  COMING_SOON: { label: "Coming Soon", color: "blue" },
  RECEIVED: { label: "Received", color: "blue" },
  VALIDATING: { label: "Validating", color: "yellow" },
  PROCESSING: { label: "Processing", color: "yellow" },
  UPLOADING: { label: "Uploading", color: "yellow" },
  FAILED: { label: "Failed", color: "red" },
  IDLE: { label: "Idle", color: "gray" },
  active: { label: "Active", color: "green" },
  inactive: { label: "Inactive", color: "gray" },
  revoked: { label: "Revoked", color: "red" },
  // Phase 3 pipeline statuses (lakehouse.pipelines.pipeline_status.PipelineStatus)
  CREATED: { label: "Created", color: "gray" },
  READING_SOURCE: { label: "Reading source", color: "yellow" },
  TRANSFORMING: { label: "Transforming", color: "yellow" },
  WRITING: { label: "Writing", color: "yellow" },
  QUALITY_CHECK: { label: "Quality check", color: "yellow" },
  SKIPPED_DUPLICATE: { label: "Skipped (duplicate)", color: "blue" },
  // Quality rule severities (lakehouse.quality.rules)
  ERROR: { label: "Error", color: "red" },
  WARNING: { label: "Warning", color: "yellow" },
  INFO: { label: "Info", color: "blue" },
  // Phase 6 subscription-service statuses (subscription lifecycle +
  // entitlement decisions).
  PENDING: { label: "Pending", color: "gray" },
  PAUSED: { label: "Paused", color: "yellow" },
  SUSPENDED: { label: "Suspended", color: "red" },
  CANCELLED: { label: "Cancelled", color: "gray" },
  ALLOW: { label: "Entitled", color: "green" },
  DENY: { label: "Not entitled", color: "red" },
  // Phase 7 scheduling-service execution statuses.
  EVALUATING: { label: "Evaluating", color: "yellow" },
  ELIGIBLE: { label: "Eligible", color: "blue" },
  DISPATCHING: { label: "Dispatching", color: "yellow" },
  SUBMITTED: { label: "Submitted", color: "blue" },
  RETRY_WAIT: { label: "Retrying", color: "yellow" },
  SKIPPED: { label: "Skipped", color: "gray" },
  SUCCEEDED: { label: "Succeeded", color: "green" },
  TERMINAL_FAILED: { label: "Failed", color: "red" },
  DEAD_LETTERED: { label: "Dead-lettered", color: "red" },
  // Phase 9 observability-service — normalized operational status
  // (operational_executions.overall_status).
  RUNNING: { label: "Running", color: "blue" },
  BLOCKED: { label: "Blocked", color: "red" },
  LATE: { label: "Late", color: "yellow" },
  UNKNOWN: { label: "Unknown", color: "gray" },
  // SLA status (technical_sla_status / business_sla_status).
  PASS: { label: "Pass", color: "green" },
  FAIL: { label: "Fail", color: "red" },
  AT_RISK: { label: "At risk", color: "yellow" },
  NOT_APPLICABLE: { label: "N/A", color: "gray" },
  // Health status (health_status).
  HEALTHY: { label: "Healthy", color: "green" },
  DEGRADED: { label: "Degraded", color: "yellow" },
  UNHEALTHY: { label: "Unhealthy", color: "red" },
  // Alert / incident state.
  OPEN: { label: "Open", color: "red" },
  ACKNOWLEDGED: { label: "Acknowledged", color: "yellow" },
  RESOLVED: { label: "Resolved", color: "green" },
  SUPPRESSED: { label: "Suppressed", color: "gray" },
  // Phase 10 catalog-service — version lifecycle status
  // (catalog.data_product_versions.lifecycle_status) and migration-plan
  // status (catalog.migration_plans.status / migration_subscriptions.status
  // — COMPLETED/BLOCKED/FAILED/SKIPPED already covered above).
  DRAFT: { label: "Draft", color: "gray" },
  BETA: { label: "Beta", color: "blue" },
  RETIRED: { label: "Retired", color: "red" },
  PLANNED: { label: "Planned", color: "gray" },
  IN_PROGRESS: { label: "In progress", color: "yellow" },
  MIGRATED: { label: "Migrated", color: "green" },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? { label: status, color: "gray" as BadgeColor };
  return <Badge color={entry.color}>{entry.label}</Badge>;
}
