import { listSchemaFields } from "../versions/schema-field.repository.js";
import { findQualityPolicy } from "../quality/quality.repository.js";
import { findSlaPolicy } from "../sla/sla.repository.js";
import { listDeliveryMethods } from "../delivery/delivery.repository.js";
import type { DataProductVersionRow } from "../versions/version.repository.js";
import type { CompatibilityField, CompatibilitySide, DeliverySnapshot } from "./compatibility.service.js";

export function toDeliverySnapshots(
  methods: Array<{ method?: string; type?: string; enabled: boolean; configuration?: Record<string, unknown> }>,
): DeliverySnapshot[] {
  return methods.map((m) => {
    const config = (m.configuration ?? {}) as { filters?: string[]; sorts?: string[] };
    return {
      method: (m.method ?? m.type)!,
      enabled: m.enabled,
      filters: config.filters,
      sorts: config.sorts,
    };
  });
}

// Shared by registration.service.ts (implicit evaluation at registration
// time) and evaluate-compatibility.service.ts (explicit dry-run, spec §23)
// so both build the exact same "previous side" snapshot from a persisted
// version — one place that knows how to translate DB rows into the
// compatibility engine's input shape.
export async function buildPreviousCompatibilitySide(previousVersionRow: DataProductVersionRow): Promise<CompatibilitySide> {
  const [fieldRows, quality, sla, delivery] = await Promise.all([
    listSchemaFields(previousVersionRow.data_product_version_id),
    findQualityPolicy(previousVersionRow.data_product_version_id),
    findSlaPolicy(previousVersionRow.data_product_version_id),
    listDeliveryMethods(previousVersionRow.data_product_version_id),
  ]);
  const fields: CompatibilityField[] = fieldRows.map((r) => ({
    fieldName: r.field_name,
    dataType: r.data_type,
    nullable: r.nullable,
    grainKey: r.grain_key,
    businessKey: r.business_key,
    customerVisible: r.customer_visible,
  }));
  return {
    fields,
    quality: quality
      ? {
          minimumCompletenessPercent: quality.minimum_completeness_percent !== null ? Number(quality.minimum_completeness_percent) : null,
          maximumInvalidPercent: quality.maximum_invalid_percent !== null ? Number(quality.maximum_invalid_percent) : null,
          grainUniqueRequired: quality.grain_unique_required,
          rules: quality.rules,
        }
      : null,
    sla: sla
      ? {
          freshnessMinutes: sla.freshness_minutes,
          availabilityTargetPercent: sla.availability_target_percent !== null ? Number(sla.availability_target_percent) : null,
          deliveryDeadlineExpression: sla.delivery_deadline_expression,
          maximumPublicationLatencyMinutes: sla.maximum_publication_latency_minutes,
        }
      : null,
    delivery: toDeliverySnapshots(delivery),
  };
}
