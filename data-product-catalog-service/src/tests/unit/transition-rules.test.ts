import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "../../modules/lifecycle/transition-rules.js";

describe("version lifecycle transition rules", () => {
  it("allows the normal forward lifecycle", () => {
    expect(canTransition("DRAFT", "BETA")).toBe(true);
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("BETA", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "DEPRECATED")).toBe(true);
    expect(canTransition("DEPRECATED", "RETIRED")).toBe(true);
  });

  it("allows a BETA that never ships to be retired directly", () => {
    expect(canTransition("BETA", "RETIRED")).toBe(true);
  });

  it("allows DEPRECATED -> ACTIVE at the table level (gated to rollback() only in lifecycle.service.ts)", () => {
    expect(canTransition("DEPRECATED", "ACTIVE")).toBe(true);
  });

  it.each([
    ["DRAFT", "RETIRED"],
    ["DRAFT", "DEPRECATED"],
    ["BETA", "DEPRECATED"],
    ["BETA", "DRAFT"],
    ["ACTIVE", "DRAFT"],
    ["ACTIVE", "BETA"],
    ["ACTIVE", "ACTIVE"],
    ["RETIRED", "ACTIVE"],
    ["RETIRED", "BETA"],
    ["RETIRED", "DRAFT"],
    ["RETIRED", "DEPRECATED"],
  ] as const)("rejects invalid transition %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow();
  });

  it("RETIRED is terminal", () => {
    expect(canTransition("RETIRED", "ACTIVE")).toBe(false);
    expect(canTransition("RETIRED", "BETA")).toBe(false);
    expect(canTransition("RETIRED", "DRAFT")).toBe(false);
    expect(canTransition("RETIRED", "DEPRECATED")).toBe(false);
  });
});
