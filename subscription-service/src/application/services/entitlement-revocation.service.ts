import type pg from "pg";
import type { AuditActor } from "./audit-actor.js";
import { findSubscriptionByTenantProduct, updateSubscriptionStatus } from "../../infrastructure/persistence/subscription.repository.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";

// Spec §18: when an entitlement is denied, an ACTIVE subscription cannot
// remain delivery-eligible — but it is SUSPENDED, never CANCELLED, so the
// customer's configured subscription (version policy, delivery preference)
// survives and can be reactivated once entitlement is restored (spec §70).
// Always called inside the same transaction as the entitlement mutation
// that triggered it (spec §41).
export async function suspendActiveSubscriptionForRevokedEntitlement(
  client: pg.PoolClient,
  organizationId: string,
  tenantId: string,
  dataProductId: string,
  actor: AuditActor,
): Promise<void> {
  const subscription = await findSubscriptionByTenantProduct(client, organizationId, tenantId, dataProductId);
  if (!subscription || subscription.status !== "ACTIVE") {
    return;
  }

  const updated = await updateSubscriptionStatus(client, {
    subscriptionId: subscription.subscriptionId,
    expectedVersion: subscription.version,
    status: "SUSPENDED",
    timestampColumn: "suspended_at",
    suspensionReason: "ENTITLEMENT_REVOKED",
    actorId: actor.actorId,
  });

  await recordAuditEvent(client, {
    organizationId,
    tenantId,
    entityType: "SUBSCRIPTION",
    entityId: subscription.subscriptionId,
    action: "SUBSCRIPTION_SUSPENDED",
    previousState: subscription,
    newState: updated,
    actorType: actor.actorType,
    actorId: actor.actorId,
    correlationId: actor.correlationId ?? null,
    idempotencyKey: null,
  });
}
