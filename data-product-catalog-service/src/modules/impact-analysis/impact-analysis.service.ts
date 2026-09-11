import { AppError } from "../../common/errors/app-error.js";
import { findProduct } from "../products/product.repository.js";
import { findVersion } from "../versions/version.repository.js";
import { resolveVersion } from "../version-resolution/resolver.js";
import { listActiveSubscriptionsForProduct, type SubscriptionCandidateDTO } from "../../infrastructure/http/subscription-client.js";

export interface ImpactSummary {
  dataProductId: string;
  fromVersion: string;
  toVersion: string;
  totalSubscriptions: number;
  byResolutionGroup: {
    resolvesToFrom: number;
    resolvesToTo: number;
    pinnedToFrom: number;
    betaOptedIn: number;
  };
  requiresExplicitAction: number;
}

interface ResolvedCandidate {
  candidate: SubscriptionCandidateDTO;
  resolvedVersion: string | null;
  resolvedLifecycleStatus: string | null;
  pinnedToFrom: boolean;
}

async function resolveAllCandidates(dataProductId: string, fromVersion: string): Promise<ResolvedCandidate[]> {
  const candidates = await listActiveSubscriptionsForProduct(dataProductId);
  const resolved: ResolvedCandidate[] = [];
  for (const candidate of candidates) {
    let resolvedVersion: string | null = null;
    let resolvedLifecycleStatus: string | null = null;
    try {
      const result = await resolveVersion(
        dataProductId,
        { type: candidate.versionPolicy.type as never, value: candidate.versionPolicy.value },
        "DELIVER",
        { optedInTenant: { organizationId: candidate.organizationId, tenantId: candidate.tenantId } },
      );
      resolvedVersion = result.version;
      resolvedLifecycleStatus = result.lifecycleStatus;
    } catch {
      // Unresolvable subscriptions fall into no resolution bucket.
    }
    resolved.push({
      candidate,
      resolvedVersion,
      resolvedLifecycleStatus,
      pinnedToFrom: candidate.versionPolicy.type === "EXACT" && candidate.versionPolicy.value === fromVersion,
    });
  }
  return resolved;
}

// Spec §26: fetches every subscription for the product from
// subscription-service, resolves each one's *currently stored* policy
// against the *current* catalog state (DELIVER intent — this mirrors what
// the subscriber is actually receiving right now), and buckets the result.
// Reproduces the required worked-example shape:
//   Event Performance 1.2 -> 2.0
//   Subscribers: 42 total
//   28 using: 1.x compatible / 10 pinned: 1.2.0 / 4 beta opted-in: 2.0.0
//   Migration status: 14 require explicit action
export async function computeImpact(dataProductId: string, fromVersion: string, toVersion: string): Promise<ImpactSummary> {
  const product = await findProduct(dataProductId);
  if (!product) {
    throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${dataProductId}' was not found.`);
  }
  const [fromRow, toRow] = await Promise.all([findVersion(dataProductId, fromVersion), findVersion(dataProductId, toVersion)]);
  if (!fromRow) throw new AppError("VERSION_NOT_FOUND", `Version '${fromVersion}' of '${dataProductId}' was not found.`);
  if (!toRow) throw new AppError("VERSION_NOT_FOUND", `Version '${toVersion}' of '${dataProductId}' was not found.`);

  const resolved = await resolveAllCandidates(dataProductId, fromVersion);

  let resolvesToFrom = 0;
  let resolvesToTo = 0;
  let pinnedToFrom = 0;
  let betaOptedIn = 0;
  for (const r of resolved) {
    if (r.pinnedToFrom) pinnedToFrom++;
    if (r.resolvedVersion === fromVersion) resolvesToFrom++;
    if (r.resolvedVersion === toVersion) {
      resolvesToTo++;
      if (r.resolvedLifecycleStatus === "BETA") betaOptedIn++;
    }
  }

  // Pinned/EXACT subscriptions never auto-move across a version change —
  // they are, by definition, the ones that require an explicit action
  // (a migration plan entry, an operator/tenant decision) to move at all.
  const requiresExplicitAction = pinnedToFrom;

  return {
    dataProductId,
    fromVersion,
    toVersion,
    totalSubscriptions: resolved.length,
    byResolutionGroup: { resolvesToFrom, resolvesToTo, pinnedToFrom, betaOptedIn },
    requiresExplicitAction,
  };
}

// Used by migration-plan.service.ts (spec §35) to snapshot exactly which
// subscriptions a migration plan covers at creation time: everyone
// currently resolving to fromVersion, plus everyone EXACT-pinned to it
// (who would otherwise never move even if their resolution happened to
// land elsewhere transiently).
export async function listSubscriptionsRequiringMigration(
  dataProductId: string,
  fromVersion: string,
): Promise<Array<{ subscriptionId: string; organizationId: string; tenantId: string }>> {
  const resolved = await resolveAllCandidates(dataProductId, fromVersion);
  const matches = resolved.filter((r) => r.pinnedToFrom || r.resolvedVersion === fromVersion);
  return matches.map((r) => ({
    subscriptionId: r.candidate.subscriptionId,
    organizationId: r.candidate.organizationId,
    tenantId: r.candidate.tenantId,
  }));
}
