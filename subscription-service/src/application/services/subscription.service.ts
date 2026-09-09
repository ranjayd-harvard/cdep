import type pg from "pg";
import { AppError } from "../../common/errors/app-error.js";
import { generateDeliveryPreferenceId, generateSubscriptionId } from "../../common/ids/id-generator.js";
import { pool } from "../../database/pool.js";
import { withTransaction } from "../../database/transaction.js";
import { validateDeliveryPreference, type DeliveryPreference, type DeliveryPreferenceInput } from "../../domain/delivery-preference.js";
import type { Subscription } from "../../domain/subscription.js";
import { assertTransition } from "../../domain/transition-rules.js";
import { formatVersionPolicy, parseVersionPolicy, type VersionPolicy } from "../../domain/version-policy.js";
import {
  assertProductActive,
  resolveVersionPolicy,
  validateDeliveryCapability,
  type ResolvedVersion,
} from "../../infrastructure/catalog-client/catalog-client.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";
import {
  findDeliveryPreferenceBySubscription,
  insertDeliveryPreference,
  updateDeliveryPreference,
} from "../../infrastructure/persistence/delivery-preference.repository.js";
import {
  findSubscriptionByIdForTenant,
  findSubscriptionByTenantProduct,
  insertSubscription,
  listSubscriptionsForTenant,
  updateSubscriptionStatus,
  updateSubscriptionVersionPolicy,
  type DeliveryCandidateFilter,
  type DeliveryCandidatePage,
  listDeliveryCandidates as listDeliveryCandidatesRepo,
  findSubscriptionById,
} from "../../infrastructure/persistence/subscription.repository.js";
import type { Queryable } from "../../infrastructure/persistence/queryable.js";
import { assertEntitlementAllows } from "./entitlement.service.js";
import type { AuditActor } from "./audit-actor.js";
import type { DeliveryContextDTO } from "../dto/delivery-context.dto.js";

export interface SubscriptionWithDelivery {
  subscription: Subscription;
  delivery: DeliveryPreference;
}

async function findOwnedSubscriptionOrThrow(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  subscriptionId: string,
): Promise<Subscription> {
  // Cross-tenant lookups return the same "not found" shape as a genuinely
  // missing subscription — existence must never leak across tenants
  // (spec §32/§52).
  const subscription = await findSubscriptionByIdForTenant(db, organizationId, tenantId, subscriptionId);
  if (!subscription) {
    throw new AppError("SUBSCRIPTION_NOT_FOUND", `Subscription '${subscriptionId}' was not found.`);
  }
  return subscription;
}

// The full spec §37 pipeline: catalog validation -> entitlement -> version
// policy -> delivery capability -> frequency, then persist subscription +
// delivery preference + audit atomically. Fail-fast on entitlement (spec
// §37 "Recommended: customer cannot create a subscription for a product
// they are not entitled to" — no request-for-access/PENDING workflow
// exists elsewhere in this platform to justify one here).
export interface CreateSubscriptionInput {
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  versionPolicy: string | VersionPolicy;
  delivery: DeliveryPreferenceInput;
}

export async function createSubscription(input: CreateSubscriptionInput, actor: AuditActor): Promise<SubscriptionWithDelivery> {
  await assertProductActive(input.dataProductId);
  await assertEntitlementAllows(pool, input.organizationId, input.tenantId, input.dataProductId);

  const policy = parseVersionPolicy(input.versionPolicy);
  const resolved = await resolveVersionPolicy(input.dataProductId, policy);

  validateDeliveryPreference(input.delivery);
  await validateDeliveryCapability(input.dataProductId, resolved.version, input.delivery.method, input.delivery.format ?? null);

  return withTransaction(async (client) => {
    const subscription = await insertSubscription(client, {
      subscriptionId: generateSubscriptionId(),
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      dataProductId: input.dataProductId,
      status: "ACTIVE",
      versionPolicyType: policy.type,
      versionPolicyValue: policy.value,
      activatedAt: new Date(),
      actorId: actor.actorId,
    });

    const delivery = await insertDeliveryPreference(client, {
      deliveryPreferenceId: generateDeliveryPreferenceId(),
      subscriptionId: subscription.subscriptionId,
      method: input.delivery.method,
      format: input.delivery.format ?? null,
      frequency: input.delivery.frequency,
      deliveryTime: input.delivery.deliveryTime ?? null,
      timezone: input.delivery.timezone ?? null,
      retentionDays: input.delivery.retentionDays ?? null,
      apiProfile: input.delivery.apiProfile ?? null,
      dayOfWeek: input.delivery.dayOfWeek ?? null,
      cronExpression: input.delivery.cronExpression ?? null,
    });

    await recordAuditEvent(client, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      entityType: "SUBSCRIPTION",
      entityId: subscription.subscriptionId,
      action: "SUBSCRIPTION_CREATED",
      previousState: null,
      newState: { subscription, delivery },
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: actor.correlationId ?? null,
      idempotencyKey: null,
    });

    return { subscription, delivery };
  });
}

export async function getSubscription(organizationId: string, tenantId: string, subscriptionId: string): Promise<SubscriptionWithDelivery> {
  const subscription = await findOwnedSubscriptionOrThrow(pool, organizationId, tenantId, subscriptionId);
  const delivery = await findDeliveryPreferenceBySubscription(pool, subscriptionId);
  if (!delivery) {
    throw new AppError("INTERNAL_ERROR", `Subscription '${subscriptionId}' is missing its delivery preference.`);
  }
  return { subscription, delivery };
}

export function listSubscriptions(organizationId: string, tenantId: string): Promise<Subscription[]> {
  return listSubscriptionsForTenant(pool, organizationId, tenantId);
}

// Re-validates full eligibility (spec §17: "Activation must always rerun
// eligibility validation. Do not blindly update status.") before any
// transition into ACTIVE.
async function revalidateEligibility(subscription: Subscription): Promise<ResolvedVersion> {
  await assertProductActive(subscription.dataProductId);
  await assertEntitlementAllows(pool, subscription.organizationId, subscription.tenantId, subscription.dataProductId);
  const resolved = await resolveVersionPolicy(subscription.dataProductId, subscription.versionPolicy);

  const delivery = await findDeliveryPreferenceBySubscription(pool, subscription.subscriptionId);
  if (!delivery) {
    throw new AppError("INTERNAL_ERROR", `Subscription '${subscription.subscriptionId}' is missing its delivery preference.`);
  }
  await validateDeliveryCapability(subscription.dataProductId, resolved.version, delivery.method, delivery.format);

  return resolved;
}

type LifecycleTransition = {
  toStatus: Subscription["status"];
  timestampColumn: "activated_at" | "paused_at" | "suspended_at" | "cancelled_at";
  auditAction: "SUBSCRIPTION_ACTIVATED" | "SUBSCRIPTION_PAUSED" | "SUBSCRIPTION_RESUMED" | "SUBSCRIPTION_SUSPENDED" | "SUBSCRIPTION_CANCELLED";
  requiresRevalidation: boolean;
  reasonField?: "suspensionReason" | "cancellationReason";
};

async function transition(
  organizationId: string,
  tenantId: string,
  subscriptionId: string,
  actor: AuditActor,
  spec: LifecycleTransition,
  reason?: string,
): Promise<Subscription> {
  const current = await findOwnedSubscriptionOrThrow(pool, organizationId, tenantId, subscriptionId);
  assertTransition(current.status, spec.toStatus);

  if (spec.requiresRevalidation) {
    await revalidateEligibility(current);
  }

  return withTransaction(async (client: pg.PoolClient) => {
    const updated = await updateSubscriptionStatus(client, {
      subscriptionId,
      expectedVersion: current.version,
      status: spec.toStatus,
      timestampColumn: spec.timestampColumn,
      suspensionReason: spec.reasonField === "suspensionReason" ? (reason ?? null) : null,
      cancellationReason: spec.reasonField === "cancellationReason" ? (reason ?? null) : null,
      actorId: actor.actorId,
    });

    await recordAuditEvent(client, {
      organizationId,
      tenantId,
      entityType: "SUBSCRIPTION",
      entityId: subscriptionId,
      action: spec.auditAction,
      previousState: current,
      newState: updated,
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: actor.correlationId ?? null,
      idempotencyKey: null,
    });

    return updated;
  });
}

export const activateSubscription = (organizationId: string, tenantId: string, subscriptionId: string, actor: AuditActor) =>
  transition(organizationId, tenantId, subscriptionId, actor, {
    toStatus: "ACTIVE",
    timestampColumn: "activated_at",
    auditAction: "SUBSCRIPTION_ACTIVATED",
    requiresRevalidation: true,
  });

export const pauseSubscription = (organizationId: string, tenantId: string, subscriptionId: string, actor: AuditActor) =>
  transition(organizationId, tenantId, subscriptionId, actor, {
    toStatus: "PAUSED",
    timestampColumn: "paused_at",
    auditAction: "SUBSCRIPTION_PAUSED",
    requiresRevalidation: false,
  });

// Handles both PAUSED -> ACTIVE and SUSPENDED -> ACTIVE (spec §17's PAUSED
// and SUSPENDED both list ACTIVE as an allowed next state) — both rerun
// full eligibility, matching demo steps 7 and 10.
export const resumeSubscription = (organizationId: string, tenantId: string, subscriptionId: string, actor: AuditActor) =>
  transition(organizationId, tenantId, subscriptionId, actor, {
    toStatus: "ACTIVE",
    timestampColumn: "activated_at",
    auditAction: "SUBSCRIPTION_RESUMED",
    requiresRevalidation: true,
  });

// Admin/platform-controlled (spec §16/§33) — not exposed on the
// customer-facing API, only /internal/v1.
export const suspendSubscription = (organizationId: string, tenantId: string, subscriptionId: string, actor: AuditActor, reason: string) =>
  transition(organizationId, tenantId, subscriptionId, actor, {
    toStatus: "SUSPENDED",
    timestampColumn: "suspended_at",
    auditAction: "SUBSCRIPTION_SUSPENDED",
    requiresRevalidation: false,
    reasonField: "suspensionReason",
  }, reason);

// Terminal (spec §16/§74 invariant #19) — always allowed regardless of
// current entitlement state; no revalidation needed to move to a dead end.
export const cancelSubscription = (organizationId: string, tenantId: string, subscriptionId: string, actor: AuditActor, reason?: string) =>
  transition(organizationId, tenantId, subscriptionId, actor, {
    toStatus: "CANCELLED",
    timestampColumn: "cancelled_at",
    auditAction: "SUBSCRIPTION_CANCELLED",
    requiresRevalidation: false,
    reasonField: "cancellationReason",
  }, reason);

export interface UpdateDeliveryPreferenceCommandInput {
  organizationId: string;
  tenantId: string;
  subscriptionId: string;
  delivery: DeliveryPreferenceInput;
}

// spec §42: a CANCELLED subscription cannot be modified. Re-validates the
// new preference against the Catalog for the subscription's currently
// resolved version before persisting (spec §24, "Catalog must remain authoritative").
export async function updateSubscriptionDeliveryPreference(input: UpdateDeliveryPreferenceCommandInput, actor: AuditActor): Promise<DeliveryPreference> {
  const subscription = await findOwnedSubscriptionOrThrow(pool, input.organizationId, input.tenantId, input.subscriptionId);
  if (subscription.status === "CANCELLED") {
    throw new AppError("INVALID_SUBSCRIPTION_STATE", "A cancelled subscription cannot be modified.");
  }

  validateDeliveryPreference(input.delivery);
  const resolved = await resolveVersionPolicy(subscription.dataProductId, subscription.versionPolicy);
  await validateDeliveryCapability(subscription.dataProductId, resolved.version, input.delivery.method, input.delivery.format ?? null);

  const current = await findDeliveryPreferenceBySubscription(pool, input.subscriptionId);
  if (!current) {
    throw new AppError("INTERNAL_ERROR", `Subscription '${input.subscriptionId}' is missing its delivery preference.`);
  }

  return withTransaction(async (client) => {
    const updated = await updateDeliveryPreference(client, {
      deliveryPreferenceId: current.deliveryPreferenceId,
      expectedVersion: current.version,
      subscriptionId: input.subscriptionId,
      method: input.delivery.method,
      format: input.delivery.format ?? null,
      frequency: input.delivery.frequency,
      deliveryTime: input.delivery.deliveryTime ?? null,
      timezone: input.delivery.timezone ?? null,
      retentionDays: input.delivery.retentionDays ?? null,
      apiProfile: input.delivery.apiProfile ?? null,
      dayOfWeek: input.delivery.dayOfWeek ?? null,
      cronExpression: input.delivery.cronExpression ?? null,
    });

    await recordAuditEvent(client, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      entityType: "SUBSCRIPTION",
      entityId: input.subscriptionId,
      action: "DELIVERY_PREFERENCE_CHANGED",
      previousState: current,
      newState: updated,
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: actor.correlationId ?? null,
      idempotencyKey: null,
    });

    return updated;
  });
}

export interface UpdateVersionPolicyCommandInput {
  organizationId: string;
  tenantId: string;
  subscriptionId: string;
  versionPolicy: string | VersionPolicy;
}

export async function updateSubscriptionVersionPolicyCommand(input: UpdateVersionPolicyCommandInput, actor: AuditActor): Promise<Subscription> {
  const subscription = await findOwnedSubscriptionOrThrow(pool, input.organizationId, input.tenantId, input.subscriptionId);
  if (subscription.status === "CANCELLED") {
    throw new AppError("INVALID_SUBSCRIPTION_STATE", "A cancelled subscription cannot be modified.");
  }

  const policy = parseVersionPolicy(input.versionPolicy);
  // Never silently crosses majors (spec §21) — resolving here fails fast
  // with VERSION_POLICY_NOT_RESOLVABLE if the new policy has no eligible version.
  await resolveVersionPolicy(subscription.dataProductId, policy);

  return withTransaction(async (client) => {
    const updated = await updateSubscriptionVersionPolicy(client, {
      subscriptionId: input.subscriptionId,
      expectedVersion: subscription.version,
      versionPolicyType: policy.type,
      versionPolicyValue: policy.value,
      actorId: actor.actorId,
    });

    await recordAuditEvent(client, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      entityType: "SUBSCRIPTION",
      entityId: input.subscriptionId,
      action: "VERSION_POLICY_CHANGED",
      previousState: subscription,
      newState: updated,
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: actor.correlationId ?? null,
      idempotencyKey: null,
    });

    return updated;
  });
}

export function listDeliveryCandidates(filter: DeliveryCandidateFilter): Promise<DeliveryCandidatePage> {
  return listDeliveryCandidatesRepo(pool, filter);
}

async function buildDeliveryContextDTO(subscription: Subscription): Promise<DeliveryContextDTO> {
  const delivery = await findDeliveryPreferenceBySubscription(pool, subscription.subscriptionId);
  if (!delivery) {
    throw new AppError("INTERNAL_ERROR", `Subscription '${subscription.subscriptionId}' is missing its delivery preference.`);
  }

  let resolvedProductVersion: DeliveryContextDTO["resolvedProductVersion"] = null;
  try {
    const resolved = await resolveVersionPolicy(subscription.dataProductId, subscription.versionPolicy);
    resolvedProductVersion = { version: resolved.version, lifecycleStatus: resolved.lifecycleStatus };
  } catch {
    resolvedProductVersion = null;
  }

  return {
    subscriptionId: subscription.subscriptionId,
    organizationId: subscription.organizationId,
    tenantId: subscription.tenantId,
    dataProductId: subscription.dataProductId,
    status: subscription.status,
    versionPolicy: { type: subscription.versionPolicy.type, value: subscription.versionPolicy.value },
    resolvedProductVersion,
    delivery: {
      method: delivery.method,
      format: delivery.format,
      frequency: delivery.frequency,
      deliveryTime: delivery.deliveryTime,
      timezone: delivery.timezone,
      retentionDays: delivery.retentionDays,
      apiProfile: delivery.apiProfile,
      dayOfWeek: delivery.dayOfWeek,
      cronExpression: delivery.cronExpression,
    },
  };
}

// Backs GET /internal/v1/subscriptions/:id/delivery-context (spec §36/§71).
export async function getDeliveryContext(subscriptionId: string): Promise<DeliveryContextDTO> {
  const subscription = await findSubscriptionById(pool, subscriptionId);
  if (!subscription) {
    throw new AppError("SUBSCRIPTION_NOT_FOUND", `Subscription '${subscriptionId}' was not found.`);
  }
  return buildDeliveryContextDTO(subscription);
}

// Backs GET /internal/v1/subscriptions/resolve (Phase 8, data-product-api-service):
// the API service authenticates a customer into (organization_id, active_tenant_id)
// and knows the data_product_id it's serving, but never a subscription_id — this is
// the one lookup shape Phase 6/7 never needed (both always start from an existing
// subscriptionId). Excludes CANCELLED subscriptions the same way
// findSubscriptionByTenantProduct already does for its other caller.
export async function getDeliveryContextForScope(
  organizationId: string,
  tenantId: string,
  dataProductId: string,
): Promise<DeliveryContextDTO> {
  const subscription = await findSubscriptionByTenantProduct(pool, organizationId, tenantId, dataProductId);
  if (!subscription) {
    throw new AppError(
      "SUBSCRIPTION_NOT_FOUND",
      `No subscription for data product '${dataProductId}' was found for this tenant.`,
    );
  }
  return buildDeliveryContextDTO(subscription);
}

export { formatVersionPolicy };
