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

export const OUTBOUND_STATUSES = ["PREPARING", "READY", "DOWNLOADED", "EXPIRED", "FAILED"] as const;

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
]);

export const ID_PREFIXES = {
  exchange: "exc",
  file: "file",
  event: "evt",
  validation: "val",
  correlation: "corr",
  pipelineJob: "pj",
} as const;
