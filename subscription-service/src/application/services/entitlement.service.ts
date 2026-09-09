import type pg from "pg";
import { AppError } from "../../common/errors/app-error.js";
import { generateEntitlementId } from "../../common/ids/id-generator.js";
import type { AuditActor } from "./audit-actor.js";
import type { EntitlementEffect } from "../../config/constants.js";
import { evaluateEntitlement, type Entitlement, type EntitlementDecision } from "../../domain/entitlement.js";
import {
  findEntitlementByTenantProduct,
  findEntitlementById,
  listEntitlementsForTenant,
  setEntitlementEffect,
  upsertEntitlement,
} from "../../infrastructure/persistence/entitlement.repository.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";
import { pool } from "../../database/pool.js";
import { withTransaction } from "../../database/transaction.js";
import { suspendActiveSubscriptionForRevokedEntitlement } from "./entitlement-revocation.service.js";
import type { Queryable } from "../../infrastructure/persistence/queryable.js";

export async function evaluateEntitlementDecision(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  dataProductId: string,
  evaluationTime: Date = new Date(),
): Promise<EntitlementDecision> {
  const entitlement = await findEntitlementByTenantProduct(db, organizationId, tenantId, dataProductId);
  return evaluateEntitlement(entitlement, organizationId, tenantId, dataProductId, evaluationTime);
}

// Throws PRODUCT_NOT_ENTITLED unless the current decision is ALLOW. Used by
// subscription create/activate/resume (spec §18/§37) so a subscription can
// never become delivery-eligible on its own.
export async function assertEntitlementAllows(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  dataProductId: string,
): Promise<void> {
  const decision = await evaluateEntitlementDecision(db, organizationId, tenantId, dataProductId);
  if (decision.decision !== "ALLOW") {
    throw new AppError("PRODUCT_NOT_ENTITLED", `Tenant is not entitled to data product '${dataProductId}' (${decision.reason}).`);
  }
}

export interface GrantEntitlementInput {
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  effect: EntitlementEffect;
  validFrom: Date | null;
  validUntil: Date | null;
  reason: string | null;
}

// Spec §35 POST /internal/v1/entitlements — upserts the single current
// decision for this tenant/product (spec §11) and cascades a DENY into any
// ACTIVE subscription (spec §18).
export async function grantEntitlement(input: GrantEntitlementInput, actor: AuditActor): Promise<Entitlement> {
  return withTransaction(async (client) => {
    const existing = await findEntitlementByTenantProduct(client, input.organizationId, input.tenantId, input.dataProductId);

    const entitlement = await upsertEntitlement(client, {
      entitlementId: generateEntitlementId(),
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      dataProductId: input.dataProductId,
      effect: input.effect,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      reason: input.reason,
      actorId: actor.actorId,
    });

    await recordAuditEvent(client, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      entityType: "ENTITLEMENT",
      entityId: entitlement.entitlementId,
      action: input.effect === "ALLOW" ? "ENTITLEMENT_GRANTED" : "ENTITLEMENT_DENIED",
      previousState: existing,
      newState: entitlement,
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: actor.correlationId ?? null,
      idempotencyKey: null,
    });

    if (input.effect === "DENY") {
      await suspendActiveSubscriptionForRevokedEntitlement(client, input.organizationId, input.tenantId, input.dataProductId, actor);
    }

    return entitlement;
  });
}

async function setEffect(entitlementId: string, effect: EntitlementEffect, actor: AuditActor): Promise<Entitlement> {
  return withTransaction(async (client) => {
    const current = await findEntitlementById(client, entitlementId);
    if (!current) {
      throw new AppError("ENTITLEMENT_NOT_FOUND", `Entitlement '${entitlementId}' does not exist.`);
    }

    const updated = await setEntitlementEffect(client, {
      entitlementId,
      expectedVersion: current.version,
      effect,
      actorId: actor.actorId,
    });

    await recordAuditEvent(client, {
      organizationId: current.organizationId,
      tenantId: current.tenantId,
      entityType: "ENTITLEMENT",
      entityId: entitlementId,
      action: effect === "ALLOW" ? "ENTITLEMENT_GRANTED" : "ENTITLEMENT_DENIED",
      previousState: current,
      newState: updated,
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: actor.correlationId ?? null,
      idempotencyKey: null,
    });

    if (effect === "DENY") {
      await suspendActiveSubscriptionForRevokedEntitlement(client, current.organizationId, current.tenantId, current.dataProductId, actor);
    }

    return updated;
  });
}

export const allowEntitlement = (entitlementId: string, actor: AuditActor) => setEffect(entitlementId, "ALLOW", actor);
export const denyEntitlement = (entitlementId: string, actor: AuditActor) => setEffect(entitlementId, "DENY", actor);

export interface UpdateEntitlementInput {
  entitlementId: string;
  expectedVersion: number;
  validFrom?: Date | null;
  validUntil?: Date | null;
  reason?: string | null;
}

export async function updateEntitlement(input: UpdateEntitlementInput, actor: AuditActor): Promise<Entitlement> {
  return withTransaction(async (client: pg.PoolClient) => {
    const current = await findEntitlementById(client, input.entitlementId);
    if (!current) {
      throw new AppError("ENTITLEMENT_NOT_FOUND", `Entitlement '${input.entitlementId}' does not exist.`);
    }

    const updated = await setEntitlementEffect(client, {
      entitlementId: input.entitlementId,
      expectedVersion: input.expectedVersion,
      effect: current.effect,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      reason: input.reason,
      actorId: actor.actorId,
    });

    await recordAuditEvent(client, {
      organizationId: current.organizationId,
      tenantId: current.tenantId,
      entityType: "ENTITLEMENT",
      entityId: input.entitlementId,
      action: "ENTITLEMENT_UPDATED",
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

export function getEntitlement(entitlementId: string): Promise<Entitlement | null> {
  return findEntitlementById(pool, entitlementId);
}

export function listEntitlements(organizationId: string, tenantId: string): Promise<Entitlement[]> {
  return listEntitlementsForTenant(pool, organizationId, tenantId);
}
