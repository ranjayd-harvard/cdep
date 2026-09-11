import type { DataProductVersionRow } from "./version.repository.js";
import type { SchemaFieldRow } from "./schema-field.repository.js";
import type { DeliveryMethodRow } from "../delivery/delivery.repository.js";
import type { SlaPolicyRow } from "../sla/sla.repository.js";
import type { QualityPolicyRow } from "../quality/quality.repository.js";

// Customer-safe projections (spec §25-27/§55/§62): internal CI/registration
// metadata (source repo/path/commit, registered_by, internal-only schema
// fields) never crosses into these shapes. Internal API responses
// (contract.routes.ts) are built separately, straight from the raw rows.

export function toCustomerSchemaFields(fields: SchemaFieldRow[]) {
  return fields
    .filter((f) => f.customer_visible)
    .map((f) => ({
      name: f.field_name,
      type: f.data_type,
      nullable: f.nullable,
      description: f.description,
      classification: f.classification,
      businessKey: f.business_key,
      grainKey: f.grain_key,
    }));
}

export function toCustomerDeliveryMethods(methods: DeliveryMethodRow[]) {
  return methods
    .filter((m) => m.enabled)
    .map((m) => ({
      type: m.method,
      formats: (m.configuration as { formats?: string[] }).formats ?? undefined,
    }));
}

export function toCustomerSla(sla: SlaPolicyRow | null) {
  if (!sla) return null;
  return {
    freshnessMinutes: sla.freshness_minutes,
    availabilityTargetPercent: sla.availability_target_percent !== null ? Number(sla.availability_target_percent) : null,
    maximumPublicationLatencyMinutes: sla.maximum_publication_latency_minutes,
    deliveryDeadlineExpression: sla.delivery_deadline_expression,
  };
}

export function toCustomerQuality(quality: QualityPolicyRow | null) {
  if (!quality) return null;
  return {
    minimumCompletenessPercent:
      quality.minimum_completeness_percent !== null ? Number(quality.minimum_completeness_percent) : null,
    maximumInvalidPercent: quality.maximum_invalid_percent !== null ? Number(quality.maximum_invalid_percent) : null,
    grainUniqueRequired: quality.grain_unique_required,
  };
}

// Phase 10 §36: adds `compatibility` (=compatibility_type), `releasedAt`
// (=activated_at), and `deprecationDeadline` (=grace_period_end, present
// only when DEPRECATED — never a raw internal timestamp on an ACTIVE row).
export function toCustomerVersionSummary(version: DataProductVersionRow) {
  return {
    version: version.version,
    lifecycleStatus: version.lifecycle_status,
    compatibility: version.compatibility_type,
    releasedAt: version.activated_at,
    effectiveFrom: version.effective_from,
    deprecatedAt: version.deprecated_at,
    deprecationDeadline: version.lifecycle_status === "DEPRECATED" ? version.grace_period_end : null,
    successorVersion: version.successor_version,
    retiredAt: version.retired_at,
  };
}

export interface VersionDetailInputs {
  version: DataProductVersionRow;
  fields: SchemaFieldRow[];
  delivery: DeliveryMethodRow[];
  sla: SlaPolicyRow | null;
  quality: QualityPolicyRow | null;
}

export function toCustomerVersionDetail({ version, fields, delivery, sla, quality }: VersionDetailInputs) {
  return {
    version: version.version,
    lifecycleStatus: version.lifecycle_status,
    compatibility: version.compatibility_type,
    releasedAt: version.activated_at,
    description: version.description,
    grain: {
      description: version.grain_definition,
      keys: fields.filter((f) => f.grain_key).map((f) => f.field_name),
    },
    schema: toCustomerSchemaFields(fields),
    delivery: toCustomerDeliveryMethods(delivery),
    sla: toCustomerSla(sla),
    quality: toCustomerQuality(quality),
    effectiveFrom: version.effective_from,
    deprecatedAt: version.deprecated_at,
    deprecationDeadline: version.lifecycle_status === "DEPRECATED" ? version.grace_period_end : null,
    successorVersion: version.successor_version,
    retiredAt: version.retired_at,
  };
}
