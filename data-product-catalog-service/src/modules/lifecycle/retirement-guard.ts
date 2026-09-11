import { AppError } from "../../common/errors/app-error.js";
import { listActiveSubscriptionsForProduct } from "../../infrastructure/http/subscription-client.js";
import { listPendingExecutionsForVersion } from "../../infrastructure/http/scheduling-client.js";
import { listActivePublicationsForVersion } from "../../infrastructure/http/publication-client.js";
import { resolveVersion } from "../version-resolution/resolver.js";
import { listDependents, isVersionWithinRange } from "../dependencies/dependency.service.js";
import { findVersion } from "../versions/version.repository.js";

export type RetirementBlockerType =
  | "ACTIVE_SUBSCRIPTIONS"
  | "SCHEDULED_JOBS"
  | "ACTIVE_PUBLICATIONS"
  | "DEPENDENT_PRODUCTS"
  | "GRACE_PERIOD_NOT_COMPLETE";

export interface RetirementBlocker {
  type: RetirementBlockerType;
  detail: string;
  count?: number;
  hasApiConsumers?: boolean;
}

// Phase 10 §21: the full retirement safety chain, an ordered list of
// blocker checks. Each check is independent and all run regardless of
// earlier results, so a single call surfaces every blocker at once (spec's
// worked example returns the full blocker object, not just the first hit).
export async function checkRetirementBlockers(dataProductId: string, version: string): Promise<RetirementBlocker[]> {
  const blockers: RetirementBlocker[] = [];
  const versionRow = await findVersion(dataProductId, version);

  // 1. Active subscriptions whose policy currently resolves (DELIVER
  // intent — an existing subscriber mid-grace-period is a legitimate
  // reason to block, not a false positive) to this exact version.
  //
  // "API consumers" (spec §21 point 4) has no distinct check of its own —
  // data-product-api-service has no internal API/events to query, so an
  // ACTIVE-or-DEPRECATED-in-grace subscription with an API delivery method
  // is the proxy for "has API consumers," folded into this same check via
  // `hasApiConsumers` on the blocker detail, per the spec's own correction.
  const candidates = await listActiveSubscriptionsForProduct(dataProductId);
  const resolvedToThisVersion: typeof candidates = [];
  for (const candidate of candidates) {
    try {
      const resolved = await resolveVersion(
        dataProductId,
        { type: candidate.versionPolicy.type as never, value: candidate.versionPolicy.value },
        "DELIVER",
      );
      if (resolved.version === version) resolvedToThisVersion.push(candidate);
    } catch {
      // A subscription whose policy no longer resolves to anything isn't a
      // blocker for retiring this specific version.
    }
  }
  if (resolvedToThisVersion.length > 0) {
    blockers.push({
      type: "ACTIVE_SUBSCRIPTIONS",
      detail: `${resolvedToThisVersion.length} active subscription(s) currently resolve to '${version}'.`,
      count: resolvedToThisVersion.length,
      hasApiConsumers: true, // conservative: subscription delivery method isn't visible from this DTO alone
    });
  }

  // 2. Scheduled jobs referencing this version.
  const executions = await listPendingExecutionsForVersion(dataProductId, version);
  if (executions.length > 0) {
    blockers.push({
      type: "SCHEDULED_JOBS",
      detail: `${executions.length} non-terminal scheduled execution(s) reference '${version}'.`,
      count: executions.length,
    });
  }

  // 3. Active/in-flight publications for this version.
  const publications = await listActivePublicationsForVersion(dataProductId, version);
  if (publications.length > 0) {
    blockers.push({
      type: "ACTIVE_PUBLICATIONS",
      detail: `${publications.length} non-terminal publication(s) reference '${version}'.`,
      count: publications.length,
    });
  }

  // 5. Dependent products whose declared range still covers this version,
  // as long as the dependent's own version isn't itself RETIRED.
  const dependents = await listDependents(dataProductId);
  const liveDependents: string[] = [];
  for (const dep of dependents) {
    if (!isVersionWithinRange(version, dep.min_version, dep.max_version)) continue;
    const dependentVersionRow = await findVersion(dep.dependent_data_product_id, dep.dependent_version);
    if (dependentVersionRow && dependentVersionRow.lifecycle_status !== "RETIRED") {
      liveDependents.push(`${dep.dependent_data_product_id}@${dep.dependent_version}`);
    }
  }
  if (liveDependents.length > 0) {
    blockers.push({
      type: "DEPENDENT_PRODUCTS",
      detail: `Required by: ${liveDependents.join(", ")}.`,
      count: liveDependents.length,
    });
  }

  // 6. Grace period. Only applicable if this version was ever DEPRECATED
  // (retiring a BETA directly, per the state machine, has no grace period
  // to wait out).
  if (versionRow?.grace_period_end && Date.now() < versionRow.grace_period_end.getTime()) {
    blockers.push({
      type: "GRACE_PERIOD_NOT_COMPLETE",
      detail: `Grace period ends at ${versionRow.grace_period_end.toISOString()}.`,
    });
  }

  return blockers;
}

// Spec §22/§28: retirement rejection carries the full structured blocker
// list, not just a generic message — the base AppError envelope stays
// {code, message, correlationId} for every other error in this service;
// this is the one deliberate, additive exception (app.ts's error handler
// special-cases this subclass to add a `blockers` array to the response).
export class RetirementBlockedError extends AppError {
  readonly blockers: RetirementBlocker[];
  constructor(dataProductId: string, version: string, blockers: RetirementBlocker[]) {
    super(
      "VERSION_NOT_RETIRABLE",
      `Version '${version}' of '${dataProductId}' cannot be retired: ${blockers.map((b) => b.type).join(", ")}.`,
    );
    this.blockers = blockers;
  }
}
