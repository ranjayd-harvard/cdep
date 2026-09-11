export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "TENANT_ACCESS_DENIED"
  | "EXECUTION_NOT_FOUND"
  | "ALERT_NOT_FOUND"
  | "INCIDENT_NOT_FOUND"
  | "MAINTENANCE_WINDOW_NOT_FOUND"
  | "PRODUCT_STATUS_NOT_FOUND"
  | "DUPLICATE_EVENT"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  TENANT_ACCESS_DENIED: 403,
  EXECUTION_NOT_FOUND: 404,
  ALERT_NOT_FOUND: 404,
  INCIDENT_NOT_FOUND: 404,
  MAINTENANCE_WINDOW_NOT_FOUND: 404,
  // Deliberately the same status/code family as data-product-api-service's
  // anti-enumeration PRODUCT_NOT_FOUND (Phase 8 precedent) — every failure
  // mode on the customer-safe status route (not found / wrong tenant / not
  // entitled) collapses to this single 404, never distinguishing why.
  PRODUCT_STATUS_NOT_FOUND: 404,
  DUPLICATE_EVENT: 200,
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
