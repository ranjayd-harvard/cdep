import { AppError } from "../../common/errors/app-error.js";
import { pool } from "../../database/pool.js";
import { parseSemver, compareSemver } from "../../common/utils/semver.js";
import { findProduct } from "../products/product.repository.js";
import {
  insertDependency,
  listDependencies,
  listDependents,
  type VersionDependencyRow,
} from "./dependency.repository.js";

// Phase 10 §25. declareDependency validates the referenced product exists
// and that min/max parse as strict semver — it deliberately does NOT
// require any version within the range to exist yet (a dependency can be
// declared against a range before every version in it has been created).
export async function declareDependency(input: {
  dependentDataProductId: string;
  dependentVersion: string;
  dependsOnDataProductId: string;
  minVersion: string;
  maxVersion?: string;
}): Promise<VersionDependencyRow> {
  parseSemver(input.dependentVersion);
  parseSemver(input.minVersion);
  if (input.maxVersion) parseSemver(input.maxVersion);

  if (input.dependsOnDataProductId === input.dependentDataProductId) {
    throw new AppError("VALIDATION_ERROR", "A Data Product cannot declare a version dependency on itself.");
  }
  const dependsOnProduct = await findProduct(input.dependsOnDataProductId);
  if (!dependsOnProduct) {
    throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${input.dependsOnDataProductId}' was not found.`);
  }

  return insertDependency(pool, {
    dependentDataProductId: input.dependentDataProductId,
    dependentVersion: input.dependentVersion,
    dependsOnDataProductId: input.dependsOnDataProductId,
    minVersion: input.minVersion,
    maxVersion: input.maxVersion ?? null,
  });
}

export { listDependencies, listDependents };

// True when `version` falls within [minVersion, maxVersion) — max is
// exclusive, unbounded when null (spec §8/§25's documented convention).
export function isVersionWithinRange(version: string, minVersion: string, maxVersion: string | null): boolean {
  if (compareSemver(version, minVersion) < 0) return false;
  if (maxVersion !== null && compareSemver(version, maxVersion) >= 0) return false;
  return true;
}
