import { describe, expect, it } from "vitest";
import { formatVersionPolicy, parseVersionPolicy } from "../../domain/version-policy.js";
import { AppError } from "../../common/errors/app-error.js";

describe("parseVersionPolicy", () => {
  it("parses an exact version", () => {
    expect(parseVersionPolicy("1.2.0")).toEqual({ type: "EXACT", value: "1.2.0" });
  });

  it("parses a major-version wildcard", () => {
    expect(parseVersionPolicy("1.x")).toEqual({ type: "COMPATIBLE_MAJOR", value: "1" });
  });

  it("parses a bare major number as compatible-major", () => {
    expect(parseVersionPolicy("1")).toEqual({ type: "COMPATIBLE_MAJOR", value: "1" });
  });

  it('parses "latest" as LATEST_ACTIVE', () => {
    expect(parseVersionPolicy("latest")).toEqual({ type: "LATEST_ACTIVE", value: null });
  });

  it("is case-insensitive for latest and X wildcard", () => {
    expect(parseVersionPolicy("LATEST")).toEqual({ type: "LATEST_ACTIVE", value: null });
    expect(parseVersionPolicy("2.X")).toEqual({ type: "COMPATIBLE_MAJOR", value: "2" });
  });

  it("passes through an already-normalized object", () => {
    const policy = { type: "EXACT" as const, value: "1.0.0" };
    expect(parseVersionPolicy(policy)).toBe(policy);
  });

  it("rejects unparsable input", () => {
    expect(() => parseVersionPolicy("not-a-version")).toThrow(AppError);
  });

  it("round-trips through formatVersionPolicy", () => {
    expect(formatVersionPolicy(parseVersionPolicy("1.x"))).toBe("1.x");
    expect(formatVersionPolicy(parseVersionPolicy("1.2.0"))).toBe("1.2.0");
    expect(formatVersionPolicy(parseVersionPolicy("latest"))).toBe("latest");
  });
});
