export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "EXCHANGE_NOT_FOUND"
  | "DATA_PRODUCT_NOT_FOUND"
  | "PIPELINE_JOB_NOT_FOUND"
  | "ENTITLEMENT_DENIED"
  | "INVALID_STATE_TRANSITION"
  | "INVALID_FILE"
  | "FILE_TOO_LARGE"
  | "OBJECT_NOT_FOUND"
  | "EXCHANGE_EXPIRED"
  | "CHECKSUM_MISMATCH"
  | "CONFLICT"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  EXCHANGE_NOT_FOUND: 404,
  DATA_PRODUCT_NOT_FOUND: 404,
  PIPELINE_JOB_NOT_FOUND: 404,
  ENTITLEMENT_DENIED: 403,
  INVALID_STATE_TRANSITION: 409,
  INVALID_FILE: 422,
  FILE_TOO_LARGE: 413,
  OBJECT_NOT_FOUND: 404,
  EXCHANGE_EXPIRED: 410,
  CHECKSUM_MISMATCH: 422,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
  }
}

// Cross-tenant existence must never be revealed (see AGENTS.md section 47):
// requesting another tenant's exchange must look identical to requesting
// one that never existed at all.
export function notFoundError(message = "The requested exchange was not found.") {
  return new AppError("EXCHANGE_NOT_FOUND", message);
}
