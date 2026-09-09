import { describe, expect, it } from "vitest";
import { compareSemVer, isAnyBump, isMajorBump, isMinorOrHigherBump, parseSemVer } from "../../common/utils/semver.js";

describe("parseSemVer", () => {
  it("parses MAJOR.MINOR.PATCH", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, raw: "1.2.3" });
  });

  it("parses MAJOR.MINOR with implicit patch 0", () => {
    expect(parseSemVer("1.0")).toEqual({ major: 1, minor: 0, patch: 0, raw: "1.0" });
  });

  it("rejects malformed input", () => {
    expect(parseSemVer("v1.2")).toBeNull();
    expect(parseSemVer("1")).toBeNull();
    expect(parseSemVer("latest")).toBeNull();
  });
});

describe("version bump classification", () => {
  const prev = parseSemVer("1.2.0")!;

  it("recognizes a major bump", () => {
    expect(isMajorBump(prev, parseSemVer("2.0.0")!)).toBe(true);
    expect(isMajorBump(prev, parseSemVer("2.1.0")!)).toBe(false);
  });

  it("recognizes a minor-or-higher bump", () => {
    expect(isMinorOrHigherBump(prev, parseSemVer("1.3.0")!)).toBe(true);
    expect(isMinorOrHigherBump(prev, parseSemVer("2.0.0")!)).toBe(true);
    expect(isMinorOrHigherBump(prev, parseSemVer("1.2.1")!)).toBe(false);
  });

  it("recognizes any forward bump, including patch-only", () => {
    expect(isAnyBump(prev, parseSemVer("1.2.1")!)).toBe(true);
    expect(isAnyBump(prev, parseSemVer("1.2.0")!)).toBe(false);
    expect(isAnyBump(prev, parseSemVer("1.1.9")!)).toBe(false);
  });

  it("compares versions", () => {
    expect(compareSemVer(parseSemVer("1.2.0")!, parseSemVer("1.10.0")!)).toBeLessThan(0);
  });
});
