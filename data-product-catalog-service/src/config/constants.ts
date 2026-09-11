// Service-to-service roles (spec §37). This service is internal-API-key
// gated for /internal/v1/* and open/read-only for /v1/* — a role is still
// attached to every internal caller for auditability (registration_events
// actor_id) and for future fine-grained authorization.
export const ROLES = [
  "CATALOG_READER",
  "CONTRACT_REGISTRAR",
  "PRODUCT_ADMIN",
  "PLATFORM_ADMIN",
  // Phase 11 (spec §9) — canonical platform roles that may reach this
  // service's internal API as a Keycloak-issued operator identity.
  "DATA_STEWARD",
  "PLATFORM_OPERATOR",
  "SECURITY_ADMIN",
  "SERVICE",
] as const;
export type Role = (typeof ROLES)[number];

export const DOMAIN_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const OWNER_TYPES = ["TEAM", "PERSON", "SYSTEM"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const OWNER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type OwnerStatus = (typeof OWNER_STATUSES)[number];

export const PRODUCT_TYPES = ["DATASET", "API", "FILE", "MULTI_CHANNEL"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_STATUSES = ["ACTIVE", "DEPRECATED", "RETIRED", "DRAFT"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const VERSION_LIFECYCLE_STATUSES = ["DRAFT", "BETA", "ACTIVE", "DEPRECATED", "RETIRED"] as const;
export type VersionLifecycleStatus = (typeof VERSION_LIFECYCLE_STATUSES)[number];

export const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

// Phase 11 governance metadata (spec §19) — platform metadata only, not an
// automatic legal/regulatory determination (spec §19 explicitly warns
// against inferring regulatory status from field names alone).
export const PII_TYPES = [
  "NONE",
  "NAME",
  "EMAIL",
  "PHONE",
  "ADDRESS",
  "DATE_OF_BIRTH",
  "GOVERNMENT_ID",
  "FINANCIAL",
  "LOCATION",
  "DEVICE_IDENTIFIER",
  "OTHER",
] as const;
export type PiiType = (typeof PII_TYPES)[number];

// Column policy (spec §21). ALLOW passes the value through unchanged; the
// others are enforced identically for FILE and API delivery (see
// data-publication-service's masking.py and data-product-api-service's
// response-projector.ts).
export const MASKING_POLICIES = ["ALLOW", "REDACT", "MASK", "HASH", "DENY"] as const;
export type MaskingPolicy = (typeof MASKING_POLICIES)[number];

export const CONTRACT_FORMATS = ["YAML", "JSON"] as const;
export type ContractFormat = (typeof CONTRACT_FORMATS)[number];

export const CONTRACT_STATUSES = ["REGISTERED", "SUPERSEDED", "INVALIDATED"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const DELIVERY_METHODS = ["FILE", "API", "SFTP", "DATA_SHARE", "EVENT", "STREAM"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const FILE_FORMATS = ["PARQUET", "CSV"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export const COMPATIBILITY_LEVELS = ["NON_BREAKING", "BREAKING", "METADATA_ONLY"] as const;
export type CompatibilityLevel = (typeof COMPATIBILITY_LEVELS)[number];

export const REGISTRATION_EVENT_TYPES = [
  "PRODUCT_CREATED",
  "CONTRACT_REGISTERED",
  "CONTRACT_DUPLICATE_DETECTED",
  "COMPATIBILITY_CHECK_PASSED",
  "COMPATIBILITY_CHECK_FAILED",
  "VERSION_CREATED",
  "VERSION_ACTIVATED",
  "VERSION_DEPRECATED",
  "VERSION_RETIRED",
  // Phase 10 additions (spec §12).
  "COMPATIBILITY_EVALUATED",
  "VERSION_APPROVED",
  "VERSION_BETA_OPT_IN_GRANTED",
  "MIGRATION_CREATED",
  "MIGRATION_STATUS_CHANGED",
  "SUBSCRIPTION_MIGRATED",
  "VERSION_RETIREMENT_BLOCKED",
  "VERSION_ROLLBACK",
] as const;
export type RegistrationEventType = (typeof REGISTRATION_EVENT_TYPES)[number];

export const ID_PREFIXES = {
  dataProductVersion: "dpv",
  schemaField: "fld",
  contract: "ctr",
  qualityPolicy: "qp",
  slaPolicy: "sla",
  deliveryMethod: "dm",
  publicationPolicy: "pp",
  registrationEvent: "reg",
  correlation: "corr",
  // Phase 10 additions.
  compatibilityResult: "cmp",
  versionDependency: "vdp",
  migrationPlan: "mig",
  migrationSubscription: "migsub",
  versionApproval: "apr",
  betaOptIn: "beta",
  // Phase 11.
  auditEvent: "aud",
} as const;

// Phase 11 (spec §29) — security/governance event vocabulary emitted by
// this service.
export const SECURITY_EVENT_TYPES = ["ACCESS_ALLOWED", "ACCESS_DENIED", "CONTRACT_POLICY_VIOLATION"] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];
