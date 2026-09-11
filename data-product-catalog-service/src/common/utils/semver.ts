export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

const SEMVER_RE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

// Accepts "1.2" (patch defaults to 0) as well as full "1.2.3", since both
// appear in the spec's examples (data-publication-service's existing
// contract uses version: "1.0").
export function parseSemVer(input: string): SemVer | null {
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] !== undefined ? Number(match[3]) : 0,
    raw: input.trim(),
  };
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function isMajorBump(prev: SemVer, next: SemVer): boolean {
  return next.major > prev.major && next.minor === 0 && next.patch === 0;
}

export function isMinorOrHigherBump(prev: SemVer, next: SemVer): boolean {
  if (next.major > prev.major) return true;
  return next.major === prev.major && next.minor > prev.minor;
}

export function isAnyBump(prev: SemVer, next: SemVer): boolean {
  return compareSemVer(next, prev) > 0;
}

// --- Phase 10 §3-§5: the one common strict semver implementation ---
//
// The functions above stay as-is (`parseSemVer` accepts a bare "1.2" for
// backward compatibility with pre-Phase-10 contracts/fixtures that already
// rely on it, e.g. data-publication-service's "1.0"). Phase 10 code is new,
// so it uses this stricter API instead of loosening the existing one:
// every Data Product version from here on must be a full MAJOR.MINOR.PATCH
// (spec §4 — no "1.2", no "v1.2.0", matching subscription-service's
// `EXACT_RE` and the `product_versions_unique` constraint). No other Phase
// 10 module parses a version string itself — they all go through this file.
export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

const STRICT_SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(version: string): SemverParts {
  const match = STRICT_SEMVER_RE.exec(version.trim());
  if (!match) {
    throw new Error(`'${version}' is not a valid semantic version (expected MAJOR.MINOR.PATCH).`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

// Classifies the bump from `from` to `to`. A version that is not strictly
// greater (equal, a downgrade, or either string malformed) is "INVALID" —
// callers (compatibility-vs-bump validation, §5/§19) reject on anything but
// MAJOR/MINOR/PATCH.
export function bumpKind(from: string, to: string): "MAJOR" | "MINOR" | "PATCH" | "SAME" | "INVALID" {
  let pf: SemverParts;
  let pt: SemverParts;
  try {
    pf = parseSemver(from);
    pt = parseSemver(to);
  } catch {
    return "INVALID";
  }
  if (pf.major === pt.major && pf.minor === pt.minor && pf.patch === pt.patch) return "SAME";
  if (pt.major !== pf.major) return pt.major > pf.major ? "MAJOR" : "INVALID";
  if (pt.minor !== pf.minor) return pt.minor > pf.minor ? "MINOR" : "INVALID";
  return pt.patch > pf.patch ? "PATCH" : "INVALID";
}

export function isSameMajor(a: string, b: string): boolean {
  return parseSemver(a).major === parseSemver(b).major;
}

export function isSameMajorMinor(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa.major === pb.major && pa.minor === pb.minor;
}
