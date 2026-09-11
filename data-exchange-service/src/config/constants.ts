export const ROLES = [
  "CUSTOMER_ADMIN",
  "CUSTOMER_USER",
  "CUSTOMER_READONLY",
  "SERVICE_ACCOUNT",
  "PLATFORM_ADMIN",
] as const;
export type Role = (typeof ROLES)[number];

export const EXCHANGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type ExchangeDirection = (typeof EXCHANGE_DIRECTIONS)[number];

export const INBOUND_STATUSES = [
  "PENDING_UPLOAD",
  "UPLOADING",
  "RECEIVED",
  "VALIDATING",
  "VALIDATION_FAILED",
  "VALIDATED",
  "QUEUED_FOR_INGESTION",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

// DELETED (Phase 11 §24) is reached only via the deletion workflow
// (deletion-request.service.ts), never a normal upload/download transition.
export const OUTBOUND_STATUSES = ["PREPARING", "READY", "DOWNLOADED", "EXPIRED", "FAILED", "DELETED"] as const;

export const EXCHANGE_STATUSES = [...INBOUND_STATUSES, ...OUTBOUND_STATUSES] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export const FILE_ROLES = ["DATA", "MANIFEST", "VALIDATION", "PROCESSING", "ERROR_REPORT"] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export const SUPPORTED_FILE_FORMATS = ["CSV", "JSON", "PARQUET"] as const;
export type SupportedFileFormat = (typeof SUPPORTED_FILE_FORMATS)[number];

export const EXTENSION_TO_FORMAT: Record<string, SupportedFileFormat> = {
  csv: "CSV",
  json: "JSON",
  parquet: "PARQUET",
};

export const CONTENT_TYPE_TO_FORMAT: Record<string, SupportedFileFormat> = {
  "text/csv": "CSV",
  "application/csv": "CSV",
  "application/json": "JSON",
  "application/x-parquet": "PARQUET",
  "application/octet-stream": "PARQUET",
};

// Allowed forward transitions for INBOUND exchanges. Terminal/parallel
// statuses (FAILED, CANCELLED, EXPIRED) are reachable from any non-terminal
// status via the ALLOWED_FROM_ANY set below.
export const INBOUND_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING_UPLOAD: ["UPLOADING", "RECEIVED"],
  UPLOADING: ["RECEIVED"],
  RECEIVED: ["VALIDATING"],
  VALIDATING: ["VALIDATION_FAILED", "VALIDATED"],
  VALIDATION_FAILED: [],
  VALIDATED: ["QUEUED_FOR_INGESTION"],
  QUEUED_FOR_INGESTION: ["PROCESSING"],
  PROCESSING: ["COMPLETED"],
  COMPLETED: [],
};

export const OUTBOUND_TRANSITIONS: Record<string, readonly string[]> = {
  PREPARING: ["READY"],
  READY: ["DOWNLOADED"],
  DOWNLOADED: ["DOWNLOADED"],
  // Phase 11 (spec §24) — retention/deletion only ever runs against an
  // already-EXPIRED outbound exchange.
  EXPIRED: ["DELETED"],
};

// Any non-terminal status in either direction may move to these.
export const ALLOWED_FROM_ANY = ["FAILED", "CANCELLED", "EXPIRED"] as const;

export const TERMINAL_STATUSES = new Set([
  "VALIDATION_FAILED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "DOWNLOADED",
  "DELETED",
]);

export const ID_PREFIXES = {
  exchange: "exc",
  file: "file",
  event: "evt",
  validation: "val",
  correlation: "corr",
  pipelineJob: "pj",
  deletionRequest: "del",
  auditEvent: "aud",
} as const;

// Phase 11 (spec §24) — deletion workflow states.
export const DELETION_REQUEST_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

// Phase 11 (spec §29) — security/governance event vocabulary emitted by
// this service.
export const SECURITY_EVENT_TYPES = [
  "ACCESS_ALLOWED",
  "ACCESS_DENIED",
  "CROSS_TENANT_ACCESS_BLOCKED",
  "ENTITLEMENT_DENIED",
  "SIGNED_URL_CREATED",
  "RETENTION_EXECUTED",
  "DELETION_REQUESTED",
  "DELETION_COMPLETED",
  "DELETION_BLOCKED",
  "DELETION_FAILED",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];
