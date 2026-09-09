import type { Entitlement, EntitlementDecision } from "../domain/entitlement.js";
import type { DeliveryPreference } from "../domain/delivery-preference.js";
import type { Subscription } from "../domain/subscription.js";
import type { DeliveryContextDTO } from "../application/dto/delivery-context.dto.js";

// Wire-format serializers: the JSON contracts in the Phase 6 spec (§14,
// §27/§71, §64-65) are all snake_case; domain/TS types stay camelCase
// internally. Kept as a single conversion boundary rather than scattered
// per-route object literals.

export function serializeEntitlementDecision(decision: EntitlementDecision) {
  return {
    organization_id: decision.organizationId,
    tenant_id: decision.tenantId,
    data_product_id: decision.dataProductId,
    decision: decision.decision,
    entitlement_id: decision.entitlementId,
    reason: decision.reason,
    evaluated_at: decision.evaluatedAt,
  };
}

export function serializeEntitlement(entitlement: Entitlement) {
  return {
    entitlement_id: entitlement.entitlementId,
    organization_id: entitlement.organizationId,
    tenant_id: entitlement.tenantId,
    data_product_id: entitlement.dataProductId,
    effect: entitlement.effect,
    valid_from: entitlement.validFrom,
    valid_until: entitlement.validUntil,
    reason: entitlement.reason,
    revoked_at: entitlement.revokedAt,
    revoked_by: entitlement.revokedBy,
    version: entitlement.version,
  };
}

export function serializeDeliveryPreference(delivery: DeliveryPreference) {
  return {
    method: delivery.method,
    format: delivery.format,
    frequency: delivery.frequency,
    delivery_time: delivery.deliveryTime,
    timezone: delivery.timezone,
    retention_days: delivery.retentionDays,
    api_profile: delivery.apiProfile,
    day_of_week: delivery.dayOfWeek,
    cron_expression: delivery.cronExpression,
  };
}

export function serializeSubscription(subscription: Subscription, delivery: DeliveryPreference) {
  return {
    subscription_id: subscription.subscriptionId,
    organization_id: subscription.organizationId,
    tenant_id: subscription.tenantId,
    data_product_id: subscription.dataProductId,
    status: subscription.status,
    version_policy: { type: subscription.versionPolicy.type, value: subscription.versionPolicy.value },
    delivery: serializeDeliveryPreference(delivery),
    requested_at: subscription.requestedAt,
    activated_at: subscription.activatedAt,
    paused_at: subscription.pausedAt,
    suspended_at: subscription.suspendedAt,
    cancelled_at: subscription.cancelledAt,
    suspension_reason: subscription.suspensionReason,
    cancellation_reason: subscription.cancellationReason,
    version: subscription.version,
  };
}

export function serializeDeliveryContext(dto: DeliveryContextDTO) {
  return {
    subscription_id: dto.subscriptionId,
    organization_id: dto.organizationId,
    tenant_id: dto.tenantId,
    data_product_id: dto.dataProductId,
    status: dto.status,
    version_policy: dto.versionPolicy,
    resolved_product_version: dto.resolvedProductVersion
      ? {
          version_id: dto.resolvedProductVersion.version,
          version: dto.resolvedProductVersion.version,
          lifecycle_status: dto.resolvedProductVersion.lifecycleStatus,
        }
      : null,
    delivery: {
      method: dto.delivery.method,
      format: dto.delivery.format,
      frequency: dto.delivery.frequency,
      delivery_time: dto.delivery.deliveryTime,
      timezone: dto.delivery.timezone,
      retention_days: dto.delivery.retentionDays,
      api_profile: dto.delivery.apiProfile,
      day_of_week: dto.delivery.dayOfWeek,
      cron_expression: dto.delivery.cronExpression,
    },
  };
}
