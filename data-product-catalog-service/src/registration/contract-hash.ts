import { createHash } from "node:crypto";

// Recursively sorts object keys so that two contracts differing only in key
// order or YAML formatting (spacing, quoting, key order) normalize to the
// identical JSON string, and therefore the identical hash (spec §16).
// Arrays are left in their authored order — order is semantically
// meaningful for `spec.schema` (field ordinal) and `spec.delivery.methods`.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const result: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      result[k] = canonicalize(v);
    }
    return result;
  }
  return value;
}

export function canonicalJson(contract: unknown): string {
  return JSON.stringify(canonicalize(contract));
}

export function computeContractHash(contract: unknown): string {
  return createHash("sha256").update(canonicalJson(contract), "utf8").digest("hex");
}
