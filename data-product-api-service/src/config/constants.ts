// Customer-facing identity roles this service accepts on `/v1/*` — mirrors
// subscription-service's ROLES set (spec §8.5: SecurityContext comes only
// from the validated bearer token, never from query/body).
export const ROLES = [
  "CUSTOMER_ADMIN",
  "CUSTOMER_USER",
  "CUSTOMER_READONLY",
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
  correlation: "corr",
} as const;

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;
export const MAX_RESPONSE_BYTES = 5_000_000;
