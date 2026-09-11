import { AppError } from "../../common/errors/app-error.js";
import { withTransaction } from "../../database/transaction.js";
import { pool } from "../../database/pool.js";
import type { RequestContext } from "../../auth/request-context.js";
import { env } from "../../config/env.js";
import type { VersionLifecycleStatus } from "../../config/constants.js";
import { findProduct, setCurrentActiveVersion, setProductStatus } from "../products/product.repository.js";
import {
  findActiveVersion,
  findVersion,
  listVersions,
  setLifecycleStatus,
  setVersionLineage,
  type DataProductVersionRow,
} from "../versions/version.repository.js";
import { listSchemaFields } from "../versions/schema-field.repository.js";
import { findSlaPolicy } from "../sla/sla.repository.js";
import { findQualityPolicy } from "../quality/quality.repository.js";
import { findRegisteredContractForVersion } from "../contracts/contract.repository.js";
import { recordEvent } from "../../registration/registration-event.repository.js";
import { requireApprovalIfBreaking } from "../approvals/approval.service.js";
import { assertTransition } from "./transition-rules.js";
import { checkRetirementBlockers, RetirementBlockedError } from "./retirement-guard.js";

async function requireProductAndVersion(dataProductId: string, version: string): Promise<DataProductVersionRow> {
  const product = await findProduct(dataProductId);
  if (!product) throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${dataProductId}' was not found.`);
  const versionRow = await findVersion(dataProductId, version);
  if (!versionRow) throw new AppError("VERSION_NOT_FOUND", `Version '${version}' of '${dataProductId}' was not found.`);
  return versionRow;
}

function gracePeriodEndFromNow(days: number = env.DEFAULT_GRACE_PERIOD_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// Spec §19/§20/§22-24: registration alone never makes a version ACTIVE or
// BETA. This validates the version is fully formed (contract + schema +
// SLA/quality policy all present) and, if its latest compatibility
// evaluation is BREAKING, that an approval row exists — then transitions
// it via the shared state machine (transition-rules.ts) rather than ad hoc
// status checks.
//
// `targetStatus` defaults to "ACTIVE" (the pre-Phase-10 behavior this route
// always had). Promoting to "BETA" is the same precondition set and the
// same approval gate, minus the supersession/current_active_version
// bookkeeping, which only applies when the version actually becomes the
// product's canonical ACTIVE version (spec §24/§25: BETA coexists
// alongside ACTIVE, never replaces it).
export async function activateVersion(
  dataProductId: string,
  version: string,
  actor: RequestContext,
  options: { targetStatus?: "BETA" | "ACTIVE" } = {},
): Promise<DataProductVersionRow> {
  const targetStatus = options.targetStatus ?? "ACTIVE";
  const versionRow = await requireProductAndVersion(dataProductId, version);

  // DEPRECATED -> ACTIVE is reachable only through rollbackVersion (spec
  // §17/§33) — reject it here with a clear, specific error before the
  // generic transition table (which allows the edge, for rollback's sake)
  // ever gets consulted.
  if (versionRow.lifecycle_status === "DEPRECATED") {
    throw new AppError(
      "VERSION_NOT_ACTIVATABLE",
      `Version '${version}' is DEPRECATED. Use POST .../rollback to reactivate a deprecated version, not activate.`,
    );
  }
  assertTransition(versionRow.lifecycle_status as VersionLifecycleStatus, targetStatus);

  const contract = await findRegisteredContractForVersion(versionRow.data_product_version_id);
  if (!contract) {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${version}' has no registered contract.`);
  }
  const fields = await listSchemaFields(versionRow.data_product_version_id);
  if (fields.length === 0) {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${version}' has no schema fields.`);
  }
  const [sla, quality] = await Promise.all([
    findSlaPolicy(versionRow.data_product_version_id),
    findQualityPolicy(versionRow.data_product_version_id),
  ]);
  if (!sla || !quality) {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${version}' is missing its SLA or quality policy.`);
  }
  await requireApprovalIfBreaking(pool, dataProductId, version);

  return withTransaction(async (client) => {
    if (targetStatus === "BETA") {
      await setLifecycleStatus(client, versionRow.data_product_version_id, "BETA", {});
      await recordEvent(client, {
        dataProductId,
        version,
        eventType: "VERSION_ACTIVATED",
        actor,
        eventData: { targetStatus: "BETA" },
      });
      return { ...versionRow, lifecycle_status: "BETA" };
    }

    const currentActive = await findActiveVersion(dataProductId, client);
    if (currentActive && currentActive.data_product_version_id !== versionRow.data_product_version_id) {
      await setLifecycleStatus(client, currentActive.data_product_version_id, "DEPRECATED", { deprecatedAt: new Date() });
      await setVersionLineage(client, currentActive.data_product_version_id, {
        successorVersion: version,
        // Don't overwrite an explicit grace period set by an earlier direct
        // deprecateVersion() call (spec §19) — only default one in if none
        // exists yet.
        gracePeriodEnd: currentActive.grace_period_end ?? gracePeriodEndFromNow(),
      });
      await recordEvent(client, {
        dataProductId,
        version: currentActive.version,
        eventType: "VERSION_DEPRECATED",
        actor,
        eventData: { reason: `superseded by ${version}`, supersededBy: version },
      });
    }

    await setLifecycleStatus(client, versionRow.data_product_version_id, "ACTIVE", {
      effectiveFrom: new Date(),
      activatedAt: new Date(),
    });
    await setVersionLineage(client, versionRow.data_product_version_id, { predecessorVersion: currentActive?.version ?? null });
    await setCurrentActiveVersion(client, dataProductId, version);
    await recordEvent(client, {
      dataProductId,
      version,
      eventType: "VERSION_ACTIVATED",
      actor,
      eventData: { targetStatus: "ACTIVE", previousActiveVersion: currentActive?.version ?? null },
    });

    return { ...versionRow, lifecycle_status: "ACTIVE" };
  });
}

// Spec §20: deprecating a version sets its grace period (default from
// DEFAULT_GRACE_PERIOD_DAYS, overridable per call) and, if a replacement is
// named, its successor pointer — but only clears the product's
// current_active_version pointer if this WAS the canonical ACTIVE version
// (the only source status the transition table allows into DEPRECATED).
export async function deprecateVersion(
  dataProductId: string,
  version: string,
  input: { reason?: string; replacementVersion?: string; gracePeriodDays?: number },
  actor: RequestContext,
): Promise<DataProductVersionRow> {
  const versionRow = await requireProductAndVersion(dataProductId, version);
  assertTransition(versionRow.lifecycle_status as VersionLifecycleStatus, "DEPRECATED");

  if (input.replacementVersion) {
    const replacement = await findVersion(dataProductId, input.replacementVersion);
    if (!replacement) {
      throw new AppError("VERSION_NOT_FOUND", `Replacement version '${input.replacementVersion}' of '${dataProductId}' was not found.`);
    }
  }

  return withTransaction(async (client) => {
    const wasActive = versionRow.lifecycle_status === "ACTIVE";
    await setLifecycleStatus(client, versionRow.data_product_version_id, "DEPRECATED", { deprecatedAt: new Date() });
    await setVersionLineage(client, versionRow.data_product_version_id, {
      successorVersion: input.replacementVersion ?? undefined,
      gracePeriodEnd: gracePeriodEndFromNow(input.gracePeriodDays),
    });

    if (wasActive) {
      await setCurrentActiveVersion(client, dataProductId, null);
    }

    await recordEvent(client, {
      dataProductId,
      version,
      eventType: "VERSION_DEPRECATED",
      actor,
      eventData: { reason: input.reason ?? null, replacementVersion: input.replacementVersion ?? null },
    });

    return { ...versionRow, lifecycle_status: "DEPRECATED" };
  });
}

export async function retireVersion(
  dataProductId: string,
  version: string,
  input: { reason?: string; force?: boolean },
  actor: RequestContext,
): Promise<DataProductVersionRow> {
  const versionRow = await requireProductAndVersion(dataProductId, version);
  if (versionRow.lifecycle_status === "RETIRED") {
    throw new AppError("CONFLICT", `Version '${version}' is already RETIRED.`);
  }
  // ACTIVE cannot retire directly, force or not — the state machine only
  // allows RETIRED from BETA or DEPRECATED (spec §7/§16). `force` (spec
  // §22/§29) overrides *retirement blockers* (checked in full by
  // retirement-guard.ts, step 5), never the lifecycle state machine itself.
  if (versionRow.lifecycle_status === "ACTIVE") {
    throw new AppError(
      "VERSION_NOT_RETIRABLE",
      `Version '${version}' is the current ACTIVE version. Deprecate it first (which also starts its grace period), then retire it.`,
    );
  }
  assertTransition(versionRow.lifecycle_status as VersionLifecycleStatus, "RETIRED");

  // Spec §21/§22: the full blocker chain. `force` overrides blockers, never
  // the state-machine checks above, and requires PLATFORM_ADMIN + a reason.
  const blockers = await checkRetirementBlockers(dataProductId, version);
  if (blockers.length > 0) {
    if (!input.force) {
      await withTransaction((client) =>
        recordEvent(client, {
          dataProductId,
          version,
          eventType: "VERSION_RETIREMENT_BLOCKED",
          actor,
          eventData: { blockers },
        }),
      );
      throw new RetirementBlockedError(dataProductId, version, blockers);
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new AppError("VALIDATION_ERROR", "force=true retirement requires a non-empty reason.");
    }
    if (actor.role !== "PLATFORM_ADMIN") {
      throw new AppError("FORBIDDEN", "Overriding retirement blockers with force=true requires the PLATFORM_ADMIN role.");
    }
  }

  return withTransaction(async (client) => {
    await setLifecycleStatus(client, versionRow.data_product_version_id, "RETIRED", { retiredAt: new Date() });

    const allVersions = await listVersions(dataProductId, client);
    const anyStillLive = allVersions.some(
      (v) => v.data_product_version_id !== versionRow.data_product_version_id && v.lifecycle_status !== "RETIRED",
    );
    if (!anyStillLive) {
      await setProductStatus(client, dataProductId, "RETIRED");
    }

    await recordEvent(client, {
      dataProductId,
      version,
      eventType: "VERSION_RETIRED",
      actor,
      eventData: {
        reason: input.reason ?? null,
        force: Boolean(input.force),
        overriddenBlockers: blockers.length > 0 ? blockers : undefined,
      },
    });

    return { ...versionRow, lifecycle_status: "RETIRED" };
  });
}

// Spec §33: emergency rollback, without rewriting lifecycle history. Only
// ever un-supersedes the *immediately previous* version — targetVersion
// must be both DEPRECATED and the current canonical ACTIVE version's
// recorded predecessor, so rolling back further than one step requires a
// sequence of rollbacks, keeping the audit trail a straight line. This is
// a distinct action from activateVersion (different precondition, emits
// VERSION_ROLLBACK not VERSION_ACTIVATED, and is the only way DEPRECATED ->
// ACTIVE is ever reachable — see transition-rules.ts's comment).
export async function rollbackVersion(
  dataProductId: string,
  targetVersion: string,
  actor: RequestContext,
  reason?: string,
): Promise<DataProductVersionRow> {
  const targetRow = await requireProductAndVersion(dataProductId, targetVersion);
  if (targetRow.lifecycle_status !== "DEPRECATED") {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${targetVersion}' is not DEPRECATED and cannot be rolled back to.`);
  }
  const currentActive = await findActiveVersion(dataProductId);
  if (!currentActive || currentActive.predecessor_version !== targetVersion) {
    throw new AppError(
      "VERSION_NOT_ACTIVATABLE",
      `Version '${targetVersion}' is not the immediate predecessor of the current ACTIVE version and cannot be rolled back to directly.`,
    );
  }
  assertTransition("DEPRECATED", "ACTIVE");

  return withTransaction(async (client) => {
    await setLifecycleStatus(client, currentActive.data_product_version_id, "DEPRECATED", { deprecatedAt: new Date() });
    await setVersionLineage(client, currentActive.data_product_version_id, {
      successorVersion: null,
      gracePeriodEnd: gracePeriodEndFromNow(),
    });

    await setLifecycleStatus(client, targetRow.data_product_version_id, "ACTIVE", { activatedAt: new Date() });
    await setVersionLineage(client, targetRow.data_product_version_id, { successorVersion: currentActive.version });
    await setCurrentActiveVersion(client, dataProductId, targetVersion);

    await recordEvent(client, {
      dataProductId,
      version: targetVersion,
      eventType: "VERSION_ROLLBACK",
      actor,
      eventData: { rolledBackFrom: currentActive.version, reason: reason ?? null },
    });

    return { ...targetRow, lifecycle_status: "ACTIVE" };
  });
}
