import { AppError } from "../common/errors/app-error.js";
import type { VersionPolicyType } from "../config/constants.js";

export interface VersionPolicy {
  type: VersionPolicyType;
  value: string | null;
}

const EXACT_RE = /^\d+\.\d+\.\d+$/;
const MAJOR_MINOR_X_RE = /^(\d+)\.(\d+)\.x$/i; // COMPATIBLE_PATCH shorthand, e.g. "1.2.x"
const MAJOR_X_RE = /^(\d+)\.x$/i; // COMPATIBLE_MINOR shorthand, e.g. "1.x"
const MAJOR_ONLY_RE = /^\d+$/; // bare major also means COMPATIBLE_MINOR (pre-Phase-10 behavior kept)

const STRING_PARSEABLE_TYPES = new Set<VersionPolicyType>(["EXACT", "COMPATIBLE_PATCH", "COMPATIBLE_MINOR", "LATEST_ACTIVE"]);

// Normalizes user-friendly input into the {type, value} shape stored on
// the subscription (spec §19, extended by Phase 10 §28/§32).
//
// PINNED_MAJOR has no string shorthand — spec §28's own text notes it
// stores the same `value = MAJOR` as COMPATIBLE_MINOR but is otherwise
// distinguished only by the subscription's `minor_upgrade_behavior`
// column, which a bare version string can never carry. Callers that want
// PINNED_MAJOR must pass the structured `{type: "PINNED_MAJOR", value}"`
// form directly; a `"1.x"`-style string always parses to COMPATIBLE_MINOR.
export function parseVersionPolicy(input: string | VersionPolicy): VersionPolicy {
  if (typeof input !== "string") {
    if (input.type === "PINNED_MAJOR") {
      if (!input.value || !MAJOR_ONLY_RE.test(input.value)) {
        throw new AppError("VALIDATION_ERROR", `PINNED_MAJOR requires a bare major-version value (e.g. "1"), got: ${String(input.value)}`);
      }
      return input;
    }
    if (!STRING_PARSEABLE_TYPES.has(input.type)) {
      throw new AppError("VALIDATION_ERROR", `Unrecognized version policy type: ${String(input.type)}`);
    }
    return input;
  }

  const trimmed = input.trim();

  if (trimmed.toLowerCase() === "latest") {
    return { type: "LATEST_ACTIVE", value: null };
  }

  const majorMinorX = MAJOR_MINOR_X_RE.exec(trimmed);
  if (majorMinorX) {
    return { type: "COMPATIBLE_PATCH", value: `${majorMinorX[1]}.${majorMinorX[2]}` };
  }

  const majorX = MAJOR_X_RE.exec(trimmed);
  if (majorX) {
    return { type: "COMPATIBLE_MINOR", value: majorX[1] as string };
  }

  if (MAJOR_ONLY_RE.test(trimmed)) {
    return { type: "COMPATIBLE_MINOR", value: trimmed };
  }

  if (EXACT_RE.test(trimmed)) {
    return { type: "EXACT", value: trimmed };
  }

  throw new AppError(
    "VALIDATION_ERROR",
    `Could not parse version policy '${input}'. Expected an exact version ("1.2.0"), a patch wildcard ("1.2.x"), a minor wildcard ("1.x"), or "latest". PINNED_MAJOR requires the structured {type, value} form.`,
  );
}

export function formatVersionPolicy(policy: VersionPolicy): string {
  switch (policy.type) {
    case "EXACT":
      return policy.value ?? "";
    case "COMPATIBLE_PATCH":
      return `${policy.value}.x`;
    case "COMPATIBLE_MINOR":
      return `${policy.value}.x`;
    case "PINNED_MAJOR":
      return `${policy.value}`;
    case "LATEST_ACTIVE":
      return "latest";
  }
}
