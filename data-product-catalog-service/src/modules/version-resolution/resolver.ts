import { AppError } from "../../common/errors/app-error.js";
import type { VersionLifecycleStatus } from "../../config/constants.js";
import { compareSemver, parseSemver } from "../../common/utils/semver.js";
import { findProduct } from "../products/product.repository.js";
import { listVersions, type DataProductVersionRow } from "../versions/version.repository.js";
import { hasOptIn } from "../beta-access/beta-opt-in.repository.js";

// Phase 10 §27-§29: the one shared version resolver. Every sibling service
// (subscription-service, scheduling-service, data-product-api-service)
// calls this instead of re-implementing version-ranking logic — see the
// spec's own diagnosis of the bug this replaces: a caller filtering to
// `lifecycleStatus === "ACTIVE"` only would fail resolution for a
// PINNED_MAJOR/COMPATIBLE_MINOR subscriber the moment their major version
// becomes DEPRECATED, even though a perfectly good DEPRECATED-but-serving
// version is still available within their pinned range.
export type VersionPolicyType = "EXACT" | "COMPATIBLE_PATCH" | "COMPATIBLE_MINOR" | "PINNED_MAJOR" | "LATEST_ACTIVE";

export interface VersionPolicy {
  type: VersionPolicyType;
  // EXACT: full "MAJOR.MINOR.PATCH". COMPATIBLE_PATCH: "MAJOR.MINOR".
  // COMPATIBLE_MINOR / PINNED_MAJOR: "MAJOR". LATEST_ACTIVE: null.
  value: string | null;
}

// SUBSCRIBE = creating/updating a subscription's policy: floating policies
// only ever see ACTIVE candidates, which is what makes "new subscriptions
// should not select a DEPRECATED version" true by construction.
// DELIVER = actual delivery/read time (Scheduler, API Delivery): floating
// policies also see DEPRECATED, so an existing subscriber can ride out a
// grace period instead of hard-failing the moment their pinned range's
// canonical version rotates.
export type ResolutionIntent = "SUBSCRIBE" | "DELIVER";

export interface ResolvedVersion {
  version: string;
  lifecycleStatus: VersionLifecycleStatus;
  fellBackToDeprecated: boolean;
}

function parseMajorOnly(value: string): number {
  const match = /^(\d+)$/.exec(value.trim());
  if (!match) throw new AppError("VALIDATION_ERROR", `'${value}' is not a valid MAJOR version component (expected e.g. "1").`);
  return Number(match[1]);
}

function parseMajorMinor(value: string): { major: number; minor: number } {
  const match = /^(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) throw new AppError("VALIDATION_ERROR", `'${value}' is not a valid MAJOR.MINOR component (expected e.g. "1.2").`);
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function pickBest(candidates: DataProductVersionRow[], preferredVersion?: string): DataProductVersionRow {
  if (preferredVersion) {
    const preferred = candidates.find((c) => c.version === preferredVersion);
    if (preferred) return preferred;
  }
  const sorted = [...candidates].sort((a, b) => {
    // ACTIVE before DEPRECATED; within the same status, highest semver wins.
    if (a.lifecycle_status !== b.lifecycle_status) {
      if (a.lifecycle_status === "ACTIVE") return -1;
      if (b.lifecycle_status === "ACTIVE") return 1;
    }
    return compareSemver(b.version, a.version);
  });
  return sorted[0]!;
}

export async function resolveVersion(
  dataProductId: string,
  policy: VersionPolicy,
  intent: ResolutionIntent,
  options: {
    optedInTenant?: { organizationId: string; tenantId: string };
    preferredVersion?: string;
  } = {},
): Promise<ResolvedVersion> {
  const product = await findProduct(dataProductId);
  if (!product) {
    throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${dataProductId}' was not found.`);
  }
  const allVersions = await listVersions(dataProductId);

  if (policy.type === "EXACT") {
    if (!policy.value) throw new AppError("VALIDATION_ERROR", "EXACT policy requires a value.");
    const match = allVersions.find((v) => v.version === policy.value);
    if (!match) {
      throw new AppError("NO_COMPATIBLE_VERSION", `Version '${policy.value}' of '${dataProductId}' was not found.`);
    }
    if (match.lifecycle_status === "DRAFT") {
      throw new AppError("NO_COMPATIBLE_VERSION", `Version '${policy.value}' is DRAFT and not consumable.`);
    }
    if (match.lifecycle_status === "RETIRED") {
      throw new AppError("VERSION_RETIRED_UNRESOLVABLE", `Version '${policy.value}' of '${dataProductId}' is RETIRED.`);
    }
    if (match.lifecycle_status === "BETA") {
      const opted = options.optedInTenant
        ? await hasOptIn(match.data_product_version_id, options.optedInTenant.organizationId, options.optedInTenant.tenantId)
        : false;
      if (!opted) {
        throw new AppError(
          "VERSION_REQUIRES_BETA_OPT_IN",
          `Version '${policy.value}' of '${dataProductId}' is BETA and requires an explicit tenant opt-in.`,
        );
      }
    }
    return { version: match.version, lifecycleStatus: match.lifecycle_status as VersionLifecycleStatus, fellBackToDeprecated: match.lifecycle_status === "DEPRECATED" };
  }

  if (policy.type === "LATEST_ACTIVE") {
    // The one policy type where "latest" means the single canonical ACTIVE
    // version, full stop — never DEPRECATED, regardless of intent.
    const candidates = allVersions.filter((v) => v.lifecycle_status === "ACTIVE");
    if (candidates.length === 0) {
      throw new AppError("NO_COMPATIBLE_VERSION", `'${dataProductId}' has no ACTIVE version.`);
    }
    const picked = pickBest(candidates);
    return { version: picked.version, lifecycleStatus: "ACTIVE", fellBackToDeprecated: false };
  }

  // COMPATIBLE_PATCH / COMPATIBLE_MINOR / PINNED_MAJOR: floating policies,
  // never BETA/DRAFT/RETIRED; DEPRECATED is eligible only for "DELIVER".
  if (!policy.value) throw new AppError("VALIDATION_ERROR", `${policy.type} policy requires a value.`);

  let inRange: (v: DataProductVersionRow) => boolean;
  if (policy.type === "COMPATIBLE_PATCH") {
    const { major, minor } = parseMajorMinor(policy.value);
    inRange = (v) => {
      const parsed = parseSemver(v.version);
      return parsed.major === major && parsed.minor === minor;
    };
  } else {
    const major = parseMajorOnly(policy.value);
    inRange = (v) => parseSemver(v.version).major === major;
  }

  const allowedStatuses: VersionLifecycleStatus[] = intent === "DELIVER" ? ["ACTIVE", "DEPRECATED"] : ["ACTIVE"];
  const candidates = allVersions.filter((v) => inRange(v) && allowedStatuses.includes(v.lifecycle_status as VersionLifecycleStatus));

  if (candidates.length === 0) {
    throw new AppError(
      "NO_COMPATIBLE_VERSION",
      `No ${intent === "DELIVER" ? "ACTIVE or DEPRECATED" : "ACTIVE"} version of '${dataProductId}' matches policy ${policy.type}(${policy.value}).`,
    );
  }
  const picked = pickBest(candidates, options.preferredVersion);
  return {
    version: picked.version,
    lifecycleStatus: picked.lifecycle_status as VersionLifecycleStatus,
    fellBackToDeprecated: picked.lifecycle_status === "DEPRECATED",
  };
}
