// Normalized operational vocabulary (AGENTS.md/Phase 9 spec section 4) —
// independent of any sibling service's own internal state names. Adapters'
// normalizers are the only place a sibling's real states get mapped onto
// this fixed vocabulary; nothing else in this service should reference a
// sibling-specific status string.
export const OPERATIONAL_STAGES = [
  "EXCHANGE_RECEIVED",
  "EXCHANGE_VALIDATION",
  "BRONZE_INGESTION",
  "SILVER_TRANSFORMATION",
  "GOLD_PRODUCT_BUILD",
  "QUALITY_VALIDATION",
  "PUBLICATION",
  "OUTBOUND_EXCHANGE",
  "FILE_DELIVERY",
  "API_DELIVERY",
] as const;
export type OperationalStage = (typeof OPERATIONAL_STAGES)[number];

export const OPERATIONAL_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "RETRYING",
  "BLOCKED",
  "LATE",
  "CANCELLED",
  "UNKNOWN",
] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

// A stage is "terminal" once it can no longer transition — used by
// failed-stage-detector/stuck-run-detector to decide whether a downstream
// stage that never started should be reported as BLOCKED (upstream failed)
// vs. simply PENDING (upstream still running).
export const TERMINAL_STATUSES: readonly OperationalStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

// Correlation join-key types — one row per identifier value in
// operational_execution_identifiers (Phase 9 plan section 5). Order here is
// also the priority order correlation.service.ts checks them in, since a
// downstream ID (e.g. publication_id) is more likely to already be indexed
// than an upstream one by the time a later event arrives.
export const IDENTIFIER_TYPES = [
  "PUBLICATION_ID",
  "GOLD_PIPELINE_RUN_ID",
  "SILVER_PIPELINE_RUN_ID",
  "INGESTION_ID",
  "INBOUND_EXCHANGE_ID",
  "OUTBOUND_EXCHANGE_ID",
  "SCHEDULED_RUN_ID",
  "SUBSCRIPTION_ID",
  "DELIVERY_REQUEST_ID",
  "API_REQUEST_ID",
] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export const SLA_TYPES = ["TECHNICAL", "BUSINESS", "STAGE_TARGET"] as const;
export type SlaType = (typeof SLA_TYPES)[number];

export const SLA_STATUSES = ["PASS", "FAIL", "AT_RISK", "NOT_APPLICABLE", "UNKNOWN"] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];

export const HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "AT_RISK", "UNHEALTHY", "UNKNOWN"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ALERT_STATES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "SUPPRESSED"] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_TYPES = [
  "INGESTION_FAILED",
  "PIPELINE_FAILED",
  "PIPELINE_STUCK",
  "QUALITY_THRESHOLD_BREACHED",
  "PUBLICATION_FAILED",
  "DELIVERY_LATE",
  "API_AVAILABILITY_BELOW_THRESHOLD",
  "FRESHNESS_SLA_BREACHED",
  "REPEATED_RETRIES",
  "NO_DATA_RECEIVED",
  "BUSINESS_SLA_BREACHED",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const MAINTENANCE_WINDOW_SCOPES = ["PLATFORM", "SERVICE", "PRODUCT", "PRODUCT_VERSION", "TENANT"] as const;
export type MaintenanceWindowScope = (typeof MAINTENANCE_WINDOW_SCOPES)[number];

export const INCIDENT_STATES = ["OPEN", "RESOLVED"] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

// Service-to-service roles — internal-API-key gated for /internal/v1/* and
// session-token gated for /v1/*, same convention as every sibling.
export const ROLES = [
  "CUSTOMER_ADMIN",
  "CUSTOMER_USER",
  "CUSTOMER_READONLY",
  "OBSERVABILITY_ADMIN",
  "OBSERVABILITY_READER",
  "PLATFORM_ADMIN",
  // Phase 11 (spec §9) — canonical platform roles, added not renamed.
  "PRODUCT_CONSUMER",
  "PRODUCT_OWNER",
  "DATA_STEWARD",
  "PLATFORM_OPERATOR",
  "SECURITY_ADMIN",
  "SERVICE",
] as const;
export type Role = (typeof ROLES)[number];

export const ID_PREFIXES = {
  execution: "oexec",
  stageRun: "stgr",
  event: "oevt",
  slaDefinition: "sladef",
  slaEvaluation: "slaev",
  alert: "alrt",
  incident: "inc",
  maintenanceWindow: "mwin",
  reconciliationRun: "recon",
  correlation: "corr",
} as const;
