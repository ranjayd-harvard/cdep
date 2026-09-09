// Service-to-service roles. Internal-API-key gated for /internal/v1/* and
// session-token gated for /v1/* — same convention as subscription-service.
export const ROLES = [
  "CUSTOMER_ADMIN",
  "CUSTOMER_USER",
  "CUSTOMER_READONLY",
  "SCHEDULER_ADMIN",
  "CATALOG_READER",
  "SCHEDULER_READER",
  "PLATFORM_ADMIN",
] as const;
export type Role = (typeof ROLES)[number];

// Supported now (AGENTS.md section 8). EVENT_DRIVEN/DATA_READY/THRESHOLD/
// SLA_TRIGGERED are documented future extension points only — adding one
// means adding a ScheduleStrategy, not rewriting DueScheduleScanner.
export const SCHEDULE_MODES = ["ON_DEMAND", "DAILY", "WEEKLY", "CRON"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

export const DAYS_OF_WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const EXECUTION_REASONS = ["SCHEDULED", "MANUAL", "ON_DEMAND", "MISSED_RUN_RECOVERY", "RETRY"] as const;
export type ExecutionReason = (typeof EXECUTION_REASONS)[number];

// A retry never becomes a new logical execution (AGENTS.md section 35) — it
// re-enters the pipeline against the same scheduled_execution row, so RETRY
// only ever appears as an audit/dispatch-attempt marker, not a new status.
export const EXECUTION_STATUSES = [
  "PENDING",
  "EVALUATING",
  "ELIGIBLE",
  "DISPATCHING",
  "SUBMITTED",
  "RETRY_WAIT",
  "SKIPPED",
  "SUCCEEDED",
  "TERMINAL_FAILED",
  "DEAD_LETTERED",
  "CANCELLED",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const FAILURE_CATEGORIES = [
  "TRANSIENT_DEPENDENCY_FAILURE",
  "PERMANENT_CONFIGURATION_FAILURE",
  "ACCESS_DENIED",
  "PRODUCT_UNAVAILABLE",
  "PUBLICATION_REJECTED",
  "PUBLICATION_TIMEOUT",
  "DATABASE_FAILURE",
  "INTERNAL_FAILURE",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const INELIGIBILITY_REASON_CODES = [
  "SUBSCRIPTION_NOT_ACTIVE",
  "SUBSCRIPTION_NOT_FOUND",
  "ENTITLEMENT_DENIED",
  "PRODUCT_NOT_FOUND",
  "NO_COMPATIBLE_VERSION",
  "PRODUCT_VERSION_NOT_PUBLISHABLE",
  "DELIVERY_METHOD_UNSUPPORTED",
  "FORMAT_UNSUPPORTED",
  "SCHEDULE_PAUSED",
  "DUPLICATE_EXECUTION",
  "MISSED_RUN_SKIPPED",
] as const;
export type IneligibilityReasonCode = (typeof INELIGIBILITY_REASON_CODES)[number];

// RUN_ALL is a documented extension point (AGENTS.md section 36) — accepted
// by the domain type so config validation doesn't need to change to add
// it, but DueScheduleScanner does not implement its catch-up-everything
// behavior; only RUN_LATEST/SKIP are wired up.
export const MISSED_RUN_POLICIES = ["RUN_LATEST", "SKIP", "RUN_ALL"] as const;
export type MissedRunPolicy = (typeof MISSED_RUN_POLICIES)[number];

export const DELIVERY_METHODS = ["FILE", "API"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const SCHEDULER_AUDIT_EVENT_TYPES = [
  "SCHEDULE_DUE",
  "SCHEDULE_EVALUATION_STARTED",
  "SUBSCRIPTION_REVALIDATED",
  "ENTITLEMENT_REVALIDATED",
  "VERSION_RESOLVED",
  "PUBLICATION_ELIGIBLE",
  "PUBLICATION_SKIPPED",
  "PUBLICATION_REQUEST_CREATED",
  "PUBLICATION_REQUEST_SUBMITTED",
  "PUBLICATION_REQUEST_FAILED",
  "PUBLICATION_RETRY_SCHEDULED",
  "PUBLICATION_TERMINAL_FAILURE",
  "EXECUTION_DEAD_LETTERED",
  "EXECUTION_REDRIVEN",
  "DEAD_LETTER_RESOLVED",
  "SCHEDULE_PAUSED",
  "SCHEDULE_RESUMED",
  "MANUAL_TRIGGER_REQUESTED",
  "SCHEDULER_LEADERSHIP_ACQUIRED",
  "SCHEDULER_LEADERSHIP_LOST",
] as const;
export type SchedulerAuditEventType = (typeof SCHEDULER_AUDIT_EVENT_TYPES)[number];

export const ID_PREFIXES = {
  schedulerProjection: "schp",
  scheduledExecution: "exec",
  deadLetter: "dlq",
  auditEvent: "saud",
  correlation: "corr",
} as const;
