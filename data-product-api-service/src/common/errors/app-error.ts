// Full error taxonomy from spec §8.10 — same AppError/STATUS_BY_CODE/Fastify
// setErrorHandler pattern as every other service in this monorepo.
export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_FILTER"
  | "INVALID_SORT"
  | "INVALID_CURSOR"
  | "INVALID_PAGE_SIZE"
  | "INVALID_FIELD_SELECTION"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_TOKEN"
  | "PRODUCT_NOT_FOUND"
  | "RESOURCE_NOT_FOUND"
  | "RATE_LIMIT_EXCEEDED"
  | "RESPONSE_TOO_LARGE"
  | "REQUEST_TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_FILTER: 400,
  INVALID_SORT: 400,
  INVALID_CURSOR: 400,
  INVALID_PAGE_SIZE: 400,
  INVALID_FIELD_SELECTION: 400,
  AUTHENTICATION_REQUIRED: 401,
  INVALID_TOKEN: 401,
  PRODUCT_NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,
  RATE_LIMIT_EXCEEDED: 429,
  RESPONSE_TOO_LARGE: 413,
  REQUEST_TIMEOUT: 504,
  SERVICE_UNAVAILABLE: 503,
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
