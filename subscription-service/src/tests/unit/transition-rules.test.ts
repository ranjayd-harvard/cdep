import { describe, expect, it } from "vitest";
import { AppError } from "../../common/errors/app-error.js";
import { assertTransition, canTransition } from "../../domain/transition-rules.js";

describe("subscription state transitions", () => {
  const allowed: Array<[string, string]> = [
    ["PENDING", "ACTIVE"],
    ["PENDING", "CANCELLED"],
    ["ACTIVE", "PAUSED"],
    ["ACTIVE", "SUSPENDED"],
    ["ACTIVE", "CANCELLED"],
    ["PAUSED", "ACTIVE"],
    ["PAUSED", "SUSPENDED"],
    ["PAUSED", "CANCELLED"],
    ["SUSPENDED", "ACTIVE"],
    ["SUSPENDED", "CANCELLED"],
  ];

  const rejected: Array<[string, string]> = [
    ["CANCELLED", "ACTIVE"],
    ["CANCELLED", "PENDING"],
    ["PENDING", "PAUSED"],
    ["PENDING", "SUSPENDED"],
    ["ACTIVE", "PENDING"],
  ];

  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(canTransition(from as never, to as never)).toBe(true);
    expect(() => assertTransition(from as never, to as never)).not.toThrow();
  });

  it.each(rejected)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from as never, to as never)).toBe(false);
    expect(() => assertTransition(from as never, to as never)).toThrow(AppError);
  });

  it("CANCELLED is terminal", () => {
    expect(canTransition("CANCELLED" as never, "ACTIVE" as never)).toBe(false);
    expect(canTransition("CANCELLED" as never, "PAUSED" as never)).toBe(false);
    expect(canTransition("CANCELLED" as never, "SUSPENDED" as never)).toBe(false);
    expect(canTransition("CANCELLED" as never, "CANCELLED" as never)).toBe(false);
  });
});
