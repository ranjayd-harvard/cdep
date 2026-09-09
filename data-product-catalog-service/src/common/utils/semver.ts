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
