// Service-to-service roles (spec §37). This service is internal-API-key
// gated for /internal/v1/* and open/read-only for /v1/* — a role is still
// attached to every internal caller for auditability (registration_events
// actor_id) and for future fine-grained authorization.
export const ROLES = ["CATALOG_READER", "CONTRACT_REGISTRAR", "PRODUCT_ADMIN", "PLATFORM_ADMIN"] as const;
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
} as const;
