// Service-to-service roles. This service is internal-API-key gated for
// /internal/v1/* and session-token gated for /v1/* (spec §31/§35).
export const ROLES = [
  "CUSTOMER_ADMIN",
  "CUSTOMER_USER",
  "CUSTOMER_READONLY",
  "ENTITLEMENT_ADMIN",
  "CATALOG_READER",
  "PLATFORM_ADMIN",
  // Phase 7 (scheduling-service): its outbound x-actor-role when calling
  // /internal/v1/subscriptions/delivery-candidates and
  // /internal/v1/entitlements/evaluate — must be a role subscription-
  // service's own requireInternalAuth() recognizes, same as CATALOG_READER
  // above being subscription-service's own outbound role toward Catalog.
  "SCHEDULER_READER",
  // Phase 8 (data-product-api-service): its outbound x-actor-role when
  // calling /internal/v1/entitlements/evaluate and the Phase-8 addition
  // /internal/v1/subscriptions/resolve — same pattern as SCHEDULER_READER.
  "DATA_PRODUCT_API_READER",
] as const;
export type Role = (typeof ROLES)[number];

export const ENTITLEMENT_EFFECTS = ["ALLOW", "DENY"] as const;
export type EntitlementEffect = (typeof ENTITLEMENT_EFFECTS)[number];

export const ENTITLEMENT_DECISION_REASONS = [
  "ACTIVE_ENTITLEMENT",
  "NO_ENTITLEMENT",
  "EXPLICIT_DENY",
  "NOT_YET_VALID",
  "EXPIRED",
] as const;
export type EntitlementDecisionReason = (typeof ENTITLEMENT_DECISION_REASONS)[number];

export const SUBSCRIPTION_STATUSES = ["PENDING", "ACTIVE", "PAUSED", "SUSPENDED", "CANCELLED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const VERSION_POLICY_TYPES = ["EXACT", "COMPATIBLE_MAJOR", "LATEST_ACTIVE"] as const;
export type VersionPolicyType = (typeof VERSION_POLICY_TYPES)[number];

export const DELIVERY_METHODS = ["FILE", "API"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

// CRON added for Phase 7 (scheduling-service AGENTS.md section 8/20) — a
// customer-configured cron expression, evaluated by the Scheduler in
// `timezone`. MONTHLY predates Phase 7 and has no ScheduleStrategy
// implementation yet; subscriptions using it remain valid here (Catalog/
// entitlement/delivery-capability validation is unaffected) but the
// Scheduler does not auto-schedule them until a MonthlyScheduleStrategy
// exists — manual/on-demand triggers still work regardless of frequency.
export const FREQUENCIES = ["ON_DEMAND", "DAILY", "WEEKLY", "MONTHLY", "CRON"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

// Phase 7 WEEKLY schedules need an explicit day (scheduling-service
// AGENTS.md section 19) — mirrors that service's own DAYS_OF_WEEK exactly.
export const DAYS_OF_WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const AUDIT_ACTIONS = [
  "ENTITLEMENT_GRANTED",
  "ENTITLEMENT_DENIED",
  "ENTITLEMENT_UPDATED",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_PAUSED",
  "SUBSCRIPTION_RESUMED",
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_CANCELLED",
  "VERSION_POLICY_CHANGED",
  "DELIVERY_PREFERENCE_CHANGED",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const ID_PREFIXES = {
  entitlement: "ent",
  subscription: "sub",
  deliveryPreference: "dlv",
  auditEvent: "aud",
  correlation: "corr",
} as const;
