import { describe, expect, it } from "vitest";
import { formatVersionPolicy, parseVersionPolicy } from "../../domain/version-policy.js";
import { AppError } from "../../common/errors/app-error.js";

describe("parseVersionPolicy", () => {
  it("parses an exact version", () => {
    expect(parseVersionPolicy("1.2.0")).toEqual({ type: "EXACT", value: "1.2.0" });
  });

  it("parses a minor-version wildcard (Phase 10: renamed from COMPATIBLE_MAJOR)", () => {
    expect(parseVersionPolicy("1.x")).toEqual({ type: "COMPATIBLE_MINOR", value: "1" });
  });

  it("parses a bare major number as compatible-minor", () => {
    expect(parseVersionPolicy("1")).toEqual({ type: "COMPATIBLE_MINOR", value: "1" });
  });

  it("parses a patch wildcard (Phase 10 addition)", () => {
    expect(parseVersionPolicy("1.2.x")).toEqual({ type: "COMPATIBLE_PATCH", value: "1.2" });
  });

  it('parses "latest" as LATEST_ACTIVE', () => {
    expect(parseVersionPolicy("latest")).toEqual({ type: "LATEST_ACTIVE", value: null });
  });

  it("is case-insensitive for latest and X wildcards", () => {
    expect(parseVersionPolicy("LATEST")).toEqual({ type: "LATEST_ACTIVE", value: null });
    expect(parseVersionPolicy("2.X")).toEqual({ type: "COMPATIBLE_MINOR", value: "2" });
    expect(parseVersionPolicy("2.3.X")).toEqual({ type: "COMPATIBLE_PATCH", value: "2.3" });
  });

  it("passes through an already-normalized object", () => {
    const policy = { type: "EXACT" as const, value: "1.0.0" };
    expect(parseVersionPolicy(policy)).toBe(policy);
  });

  it("PINNED_MAJOR has no string shorthand — requires the structured form", () => {
    // A bare "1" (and "1.x") always parses to COMPATIBLE_MINOR, never
    // PINNED_MAJOR — spec §28's distinction lives in minor_upgrade_behavior,
    // which no version string can carry.
    expect(parseVersionPolicy("1")).not.toEqual({ type: "PINNED_MAJOR", value: "1" });
    expect(parseVersionPolicy({ type: "PINNED_MAJOR", value: "1" })).toEqual({ type: "PINNED_MAJOR", value: "1" });
    expect(() => parseVersionPolicy({ type: "PINNED_MAJOR", value: null })).toThrow(AppError);
  });

  it("rejects unparsable input", () => {
    expect(() => parseVersionPolicy("not-a-version")).toThrow(AppError);
  });

  it("round-trips through formatVersionPolicy", () => {
    expect(formatVersionPolicy(parseVersionPolicy("1.x"))).toBe("1.x");
    expect(formatVersionPolicy(parseVersionPolicy("1.2.x"))).toBe("1.2.x");
    expect(formatVersionPolicy(parseVersionPolicy("1.2.0"))).toBe("1.2.0");
    expect(formatVersionPolicy(parseVersionPolicy("latest"))).toBe("latest");
  });
});
