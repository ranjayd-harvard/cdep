import { describe, expect, it } from "vitest";
import {
  bumpKind,
  compareSemVer,
  compareSemver,
  isAnyBump,
  isMajorBump,
  isMinorOrHigherBump,
  isSameMajor,
  isSameMajorMinor,
  parseSemVer,
  parseSemver,
} from "../../common/utils/semver.js";

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

// Phase 10 §3-§5: the strict, throw-on-invalid semver API every new module
// uses instead of parsing version strings itself.
describe("parseSemver (strict)", () => {
  it("parses a full MAJOR.MINOR.PATCH", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it.each(["1", "1.2", "v1.2.0", "1.2.beta", "-1.2.0", "1.2.0.4", "latest"])(
    "throws on malformed input %s",
    (input) => {
      expect(() => parseSemver(input)).toThrow();
    },
  );
});

describe("compareSemver", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareSemver("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("bumpKind", () => {
  it("classifies each bump type", () => {
    expect(bumpKind("1.2.0", "2.0.0")).toBe("MAJOR");
    expect(bumpKind("1.2.0", "1.3.0")).toBe("MINOR");
    expect(bumpKind("1.2.0", "1.2.1")).toBe("PATCH");
    expect(bumpKind("1.2.0", "1.2.0")).toBe("SAME");
  });

  it("classifies a downgrade or malformed input as INVALID", () => {
    expect(bumpKind("1.3.0", "1.2.0")).toBe("INVALID");
    expect(bumpKind("2.0.0", "1.9.9")).toBe("INVALID");
    expect(bumpKind("1.2.0", "not-a-version")).toBe("INVALID");
  });
});

describe("isSameMajor / isSameMajorMinor", () => {
  it("compares major only", () => {
    expect(isSameMajor("1.2.0", "1.9.0")).toBe(true);
    expect(isSameMajor("1.2.0", "2.0.0")).toBe(false);
  });

  it("compares major and minor", () => {
    expect(isSameMajorMinor("1.2.0", "1.2.9")).toBe(true);
    expect(isSameMajorMinor("1.2.0", "1.3.0")).toBe(false);
  });
});
