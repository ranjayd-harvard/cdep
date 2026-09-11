import { z } from "zod";
import {
  CLASSIFICATIONS,
  DELIVERY_METHODS,
  FILE_FORMATS,
  MASKING_POLICIES,
  PII_TYPES,
  VERSION_LIFECYCLE_STATUSES,
} from "../config/constants.js";

// Normalized shape of a "kind: DataProduct" Contract-as-Code document (spec
// §32). The CLI (scripts/validate-contract.ts / register-contract.ts) loads
// the author's YAML and reshapes it to exactly this before it ever reaches
// the API, so the registration API itself only ever deals with this
// normalized JSON — never raw YAML text.
export const schemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(false),
  grainKey: z.boolean().default(false),
  businessKey: z.boolean().default(false),
  classification: z.enum(CLASSIFICATIONS).optional(),
  description: z.string().optional(),
  customerVisible: z.boolean().default(true),
  // Phase 11 field governance (spec §18/§19/§21) — platform metadata, not
  // an automatic legal determination. registration.validator.ts requires
  // piiType/maskingPolicy to be explicitly set (not left to any implicit
  // default) whenever classification is RESTRICTED.
  pii: z.boolean().default(false),
  piiType: z.enum(PII_TYPES).optional(),
  maskingPolicy: z.enum(MASKING_POLICIES).optional(),
});

// `api` (Phase 8, spec §8.2) is the Contract-driven query policy for the
// API delivery method — filters/sorts/pagination/response-size bounds.
// This is the sole per-version source of truth for what
// data-product-api-service is allowed to query/return; it is stored as-is
// into supported_delivery_methods.configuration (see registration.service.ts),
// the same JSONB column FILE's `formats` already uses, rather than a new table.
export const apiDeliveryConfigSchema = z.object({
  resource: z.string().min(1),
  filters: z.array(z.string().min(1)).default([]),
  sorts: z.array(z.string().min(1)).default([]),
  defaultSort: z.array(z.string().min(1)).default([]),
  defaultPageSize: z.number().int().positive().default(100),
  maxPageSize: z.number().int().positive().default(500),
  maxResponseBytes: z.number().int().positive().optional(),
});

export const deliveryMethodSchema = z.object({
  type: z.enum(DELIVERY_METHODS),
  enabled: z.boolean().default(true),
  formats: z.array(z.enum(FILE_FORMATS)).optional(),
  api: apiDeliveryConfigSchema.optional(),
});

export const contractDocumentSchema = z.object({
  apiVersion: z.string().min(1),
  kind: z.literal("DataProduct"),
  metadata: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  spec: z.object({
    domain: z.object({ id: z.string().min(1) }),
    owner: z.object({ id: z.string().min(1), displayName: z.string().optional() }),
    description: z.string().optional(),
    productType: z.enum(["DATASET", "API", "FILE", "MULTI_CHANNEL"]).default("DATASET"),
    lifecycle: z.object({ status: z.enum(VERSION_LIFECYCLE_STATUSES).default("DRAFT") }).default({ status: "DRAFT" }),
    grain: z.object({
      description: z.string().optional(),
      keys: z.array(z.string().min(1)).min(1),
    }),
    schema: z.array(schemaFieldSchema).min(1),
    delivery: z.object({
      methods: z.array(deliveryMethodSchema).min(1),
    }),
    sla: z
      .object({
        freshnessMinutes: z.number().int().positive().optional(),
        availabilityTargetPercent: z.number().min(0).max(100).optional(),
        maximumPublicationLatencyMinutes: z.number().int().positive().optional(),
        deliveryDeadlineExpression: z.string().optional(),
      })
      .default({}),
    quality: z
      .object({
        minimumCompletenessPercent: z.number().min(0).max(100).optional(),
        maximumInvalidPercent: z.number().min(0).max(100).optional(),
        grainUniqueRequired: z.boolean().default(false),
        rules: z.record(z.unknown()).optional(),
      })
      .default({ grainUniqueRequired: false }),
    publication: z
      .object({
        defaultFormat: z.enum(FILE_FORMATS).optional(),
        supportedFormats: z.array(z.enum(FILE_FORMATS)).optional(),
        expirationHours: z.number().int().positive().optional(),
        filenamePattern: z.string().optional(),
        compression: z.record(z.string()).optional(),
        defaultDeliveryMode: z.string().optional(),
      })
      .default({}),
    // Phase 11 (spec §17/§18) — product/version-level governance metadata,
    // populating the already-migrated but previously-unwired
    // catalog.data_product_versions.{data_classification,retention_policy_ref,
    // contains_pii,compliance_tags} columns (migrations/013_version_lifecycle_metadata.sql).
    governance: z
      .object({
        dataClassification: z.enum(CLASSIFICATIONS).optional(),
        retentionPolicyRef: z.string().min(1).optional(),
        complianceTags: z.array(z.string().min(1)).default([]),
      })
      .default({ complianceTags: [] }),
  }),
});

export type ContractDocument = z.infer<typeof contractDocumentSchema>;
export type SchemaFieldInput = z.infer<typeof schemaFieldSchema>;
