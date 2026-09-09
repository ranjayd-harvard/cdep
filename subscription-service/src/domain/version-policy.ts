import { AppError } from "../common/errors/app-error.js";
import type { VersionPolicyType } from "../config/constants.js";

export interface VersionPolicy {
  type: VersionPolicyType;
  value: string | null;
}

const EXACT_RE = /^\d+\.\d+\.\d+$/;
const MAJOR_X_RE = /^(\d+)\.x$/i;
const MAJOR_ONLY_RE = /^\d+$/;

// Normalizes user-friendly input ("1.2.0", "1.x", "latest") into the
// {type, value} shape stored on the subscription (spec §19). Accepts the
// already-normalized object form too, for internal callers (e.g. tests,
// PATCH bodies that resend the current policy unchanged).
export function parseVersionPolicy(input: string | VersionPolicy): VersionPolicy {
  if (typeof input !== "string") {
    if (!(["EXACT", "COMPATIBLE_MAJOR", "LATEST_ACTIVE"] as const).includes(input.type)) {
      throw new AppError("VALIDATION_ERROR", `Unrecognized version policy type: ${String(input.type)}`);
    }
    return input;
  }

  const trimmed = input.trim();

  if (trimmed.toLowerCase() === "latest") {
    return { type: "LATEST_ACTIVE", value: null };
  }

  const majorX = MAJOR_X_RE.exec(trimmed);
  if (majorX) {
    return { type: "COMPATIBLE_MAJOR", value: majorX[1] as string };
  }

  if (MAJOR_ONLY_RE.test(trimmed)) {
    return { type: "COMPATIBLE_MAJOR", value: trimmed };
  }

  if (EXACT_RE.test(trimmed)) {
    return { type: "EXACT", value: trimmed };
  }

  throw new AppError(
    "VALIDATION_ERROR",
    `Could not parse version policy '${input}'. Expected an exact version ("1.2.0"), a major-version wildcard ("1.x"), or "latest".`,
  );
}

export function formatVersionPolicy(policy: VersionPolicy): string {
  switch (policy.type) {
    case "EXACT":
      return policy.value ?? "";
    case "COMPATIBLE_MAJOR":
      return `${policy.value}.x`;
    case "LATEST_ACTIVE":
      return "latest";
  }
}
