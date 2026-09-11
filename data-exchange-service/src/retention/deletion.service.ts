import { pool } from "../database/pool.js";
import { notFoundError } from "../common/errors/app-error.js";
import { assertValidTransition } from "../modules/exchanges/exchange-transitions.js";
import { getExchangeByIdInternal, getExchangeFiles, updateExchangeStatus } from "../modules/exchanges/exchange.repository.js";
import { objectStorage } from "../storage/index.js";
import { recordSecurityAuditEvent } from "../audit/audit.repository.js";
import { evaluateRetentionEligibility } from "./retention-policy.js";
import { createDeletionRequest, updateDeletionRequestStatus } from "./deletion-request.repository.js";
import type { DeletionRequestRow } from "./deletion-request.repository.js";

export interface DeletionActor {
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string;
  correlationId: string | null;
}

// Deletion control plane (spec §24): Deletion Request -> Authorization (the
// caller already passed requireInternalAuth("PLATFORM_ADMIN") at the route)
// -> Impact discovery (this service owns only the outbound artifact's
// physical objects + its own exchange row) -> Deletion Execution ->
// Verification (the storage delete + status transition either both
// succeed or the request is marked FAILED, never partially silently) ->
// Audit Evidence (every branch below writes a security_audit_events row).
export async function requestDeletion(
  exchangeId: string,
  actor: DeletionActor,
  reason?: string,
): Promise<DeletionRequestRow> {
  const exchange = await getExchangeByIdInternal(exchangeId);
  if (!exchange) throw notFoundError();

  const deletionRequest = await createDeletionRequest(pool, {
    exchangeId,
    reason: reason ?? null,
    requestedBy: actor.actorId,
  });

  await recordSecurityAuditEvent({
    eventType: "DELETION_REQUESTED",
    actorType: actor.actorType,
    actorId: actor.actorId,
    organizationId: exchange.organization_id,
    tenantId: exchange.tenant_id,
    resourceType: "exchange",
    resourceId: exchangeId,
    correlationId: actor.correlationId,
    metadata: { deletionRequestId: deletionRequest.deletion_request_id, reason: reason ?? null },
  });

  const eligibility = evaluateRetentionEligibility(exchange);
  if (!eligibility.eligible) {
    await updateDeletionRequestStatus(pool, deletionRequest.deletion_request_id, "BLOCKED", {
      errorMessage: eligibility.reason,
    });
    await recordSecurityAuditEvent({
      eventType: "DELETION_BLOCKED",
      actorType: actor.actorType,
      actorId: actor.actorId,
      organizationId: exchange.organization_id,
      tenantId: exchange.tenant_id,
      resourceType: "exchange",
      resourceId: exchangeId,
      decision: "DENY",
      reasonCode: eligibility.reason,
      correlationId: actor.correlationId,
      metadata: { deletionRequestId: deletionRequest.deletion_request_id },
    });
    return { ...deletionRequest, status: "BLOCKED", error_message: eligibility.reason };
  }

  await updateDeletionRequestStatus(pool, deletionRequest.deletion_request_id, "IN_PROGRESS");

  try {
    const files = await getExchangeFiles(exchangeId);
    for (const file of files) {
      await objectStorage.deleteObject(file.bucket_name, file.object_key);
    }

    assertValidTransition("OUTBOUND", exchange.status, "DELETED");
    await updateExchangeStatus(exchangeId, exchange.organization_id, exchange.tenant_id, "DELETED");

    const completedAt = new Date();
    await updateDeletionRequestStatus(pool, deletionRequest.deletion_request_id, "COMPLETED", { completedAt });

    await recordSecurityAuditEvent({
      eventType: "RETENTION_EXECUTED",
      actorType: actor.actorType,
      actorId: actor.actorId,
      organizationId: exchange.organization_id,
      tenantId: exchange.tenant_id,
      resourceType: "exchange",
      resourceId: exchangeId,
      decision: "ALLOW",
      reasonCode: "RETENTION_POLICY_ELIGIBLE",
      correlationId: actor.correlationId,
      metadata: { deletionRequestId: deletionRequest.deletion_request_id, filesDeleted: files.length },
    });
    await recordSecurityAuditEvent({
      eventType: "DELETION_COMPLETED",
      actorType: actor.actorType,
      actorId: actor.actorId,
      organizationId: exchange.organization_id,
      tenantId: exchange.tenant_id,
      resourceType: "exchange",
      resourceId: exchangeId,
      correlationId: actor.correlationId,
      metadata: { deletionRequestId: deletionRequest.deletion_request_id },
    });

    return { ...deletionRequest, status: "COMPLETED", completed_at: completedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateDeletionRequestStatus(pool, deletionRequest.deletion_request_id, "FAILED", { errorMessage: message });
    await recordSecurityAuditEvent({
      eventType: "DELETION_FAILED",
      actorType: actor.actorType,
      actorId: actor.actorId,
      organizationId: exchange.organization_id,
      tenantId: exchange.tenant_id,
      resourceType: "exchange",
      resourceId: exchangeId,
      correlationId: actor.correlationId,
      metadata: { deletionRequestId: deletionRequest.deletion_request_id, error: message },
    });
    return { ...deletionRequest, status: "FAILED", error_message: message };
  }
}

export async function setLegalHold(exchangeId: string, legalHold: boolean, actor: DeletionActor): Promise<void> {
  const exchange = await getExchangeByIdInternal(exchangeId);
  if (!exchange) throw notFoundError();

  await pool.query(`UPDATE exchange.exchanges SET legal_hold = $2, updated_at = now() WHERE exchange_id = $1`, [
    exchangeId,
    legalHold,
  ]);

  await recordSecurityAuditEvent({
    eventType: "ACCESS_ALLOWED",
    actorType: actor.actorType,
    actorId: actor.actorId,
    organizationId: exchange.organization_id,
    tenantId: exchange.tenant_id,
    resourceType: "exchange",
    resourceId: exchangeId,
    reasonCode: legalHold ? "LEGAL_HOLD_SET" : "LEGAL_HOLD_CLEARED",
    correlationId: actor.correlationId,
    metadata: { legalHold },
  });
}
