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
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? { label: status, color: "gray" as BadgeColor };
  return <Badge color={entry.color}>{entry.label}</Badge>;
}
