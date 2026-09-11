import type pg from "pg";
import { AppError } from "../../common/errors/app-error.js";
import type { RequestContext } from "../../auth/request-context.js";
import type { CompatibilityLevel } from "../../config/constants.js";
import { findLatestCompatibilityResult } from "../compatibility/compatibility-result.repository.js";
import { findLatestApproval, recordApproval } from "./approval.repository.js";
import { recordEvent } from "../../registration/registration-event.repository.js";

// Phase 10 §22/§24: a BREAKING version cannot leave DRAFT for BETA/ACTIVE
// without a matching approval row. Looks at the *latest* compatibility
// evaluation for this exact version (not the version row's own persisted
// compatibility_type, which stays fixed at creation time) so a fresh
// dry-run re-evaluation is what approval gating actually reacts to.
export async function requireApprovalIfBreaking(
  client: pg.Pool | pg.PoolClient,
  dataProductId: string,
  version: string,
): Promise<void> {
  const latest = await findLatestCompatibilityResult(dataProductId, version, client);
  const level: CompatibilityLevel = latest?.compatibility_level ?? "NON_BREAKING";
  if (level !== "BREAKING") return;

  const approval = await findLatestApproval(dataProductId, version, client);
  if (!approval) {
    throw new AppError(
      "VERSION_APPROVAL_REQUIRED",
      `Version '${version}' of '${dataProductId}' has a BREAKING compatibility evaluation and requires an explicit approval (POST .../versions/${version}/approve) before it may leave DRAFT.`,
    );
  }
}

export async function approveVersion(
  client: pg.PoolClient,
  input: { dataProductId: string; version: string; reason?: string; actor: RequestContext },
) {
  const latest = await findLatestCompatibilityResult(input.dataProductId, input.version, client);
  const level: CompatibilityLevel = latest?.compatibility_level ?? "NON_BREAKING";

  const approval = await recordApproval(client, {
    dataProductId: input.dataProductId,
    version: input.version,
    compatibilityLevel: level,
    required: level === "BREAKING",
    approvedBy: input.actor.actorId,
    approvedReason: input.reason,
  });

  await recordEvent(client, {
    dataProductId: input.dataProductId,
    version: input.version,
    eventType: "VERSION_APPROVED",
    actor: input.actor,
    eventData: { compatibilityLevel: level, reason: input.reason ?? null },
  });

  return approval;
}
