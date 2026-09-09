import { AppError } from "../common/errors/app-error.js";
import { parseSemVer } from "../common/utils/semver.js";
import type { ContractDocument } from "./contract-schema.js";

// Structural validation beyond what Zod's shape check covers — the checks
// listed explicitly in spec §48 (duplicate fields, grain fields exist,
// delivery formats, SLA/quality sanity) and §15 (identify product/version).
// Shared by the registration service and `npm run contract:validate` so the
// CLI and the API can never disagree about what "valid" means.
export function validateContractStructure(doc: ContractDocument): void {
  if (!parseSemVer(doc.metadata.version)) {
    throw new AppError(
      "CONTRACT_INVALID",
      `metadata.version '${doc.metadata.version}' is not a valid semantic version (expected MAJOR.MINOR or MAJOR.MINOR.PATCH).`,
    );
  }

  const fieldNames = new Set<string>();
  for (const field of doc.spec.schema) {
    if (fieldNames.has(field.name)) {
      throw new AppError("CONTRACT_INVALID", `Duplicate schema field '${field.name}'.`);
    }
    fieldNames.add(field.name);
  }

  for (const key of doc.spec.grain.keys) {
    if (!fieldNames.has(key)) {
      throw new AppError("CONTRACT_INVALID", `Grain key '${key}' is not present in spec.schema.`);
    }
  }

  const grainKeyFieldsDeclared = doc.spec.schema.filter((f) => f.grainKey).map((f) => f.name);
  for (const name of grainKeyFieldsDeclared) {
    if (!doc.spec.grain.keys.includes(name)) {
      throw new AppError(
        "CONTRACT_INVALID",
        `Field '${name}' is marked grainKey: true but is not listed in spec.grain.keys.`,
      );
    }
  }

  for (const method of doc.spec.delivery.methods) {
    if (method.type === "FILE" && method.enabled && (!method.formats || method.formats.length === 0)) {
      throw new AppError("CONTRACT_INVALID", "FILE delivery method must declare at least one format when enabled.");
    }
  }

  if (
    doc.spec.sla.availabilityTargetPercent !== undefined &&
    (doc.spec.sla.availabilityTargetPercent < 0 || doc.spec.sla.availabilityTargetPercent > 100)
  ) {
    throw new AppError("CONTRACT_INVALID", "sla.availabilityTargetPercent must be between 0 and 100.");
  }

  if (
    doc.spec.quality.minimumCompletenessPercent !== undefined &&
    (doc.spec.quality.minimumCompletenessPercent < 0 || doc.spec.quality.minimumCompletenessPercent > 100)
  ) {
    throw new AppError("CONTRACT_INVALID", "quality.minimumCompletenessPercent must be between 0 and 100.");
  }

  if (doc.spec.quality.grainUniqueRequired && doc.spec.grain.keys.length === 0) {
    throw new AppError("CONTRACT_INVALID", "quality.grainUniqueRequired is set but spec.grain.keys is empty.");
  }
}
