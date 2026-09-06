import { describe, expect, it } from "vitest";
import { assertValidTransition } from "../../modules/exchanges/exchange-transitions.js";
import { AppError } from "../../common/errors/app-error.js";

describe("assertValidTransition", () => {
  it("allows RECEIVED -> VALIDATING for inbound", () => {
    expect(() => assertValidTransition("INBOUND", "RECEIVED", "VALIDATING")).not.toThrow();
  });

  it("rejects skipping states", () => {
    expect(() => assertValidTransition("INBOUND", "PENDING_UPLOAD", "VALIDATED")).toThrow(AppError);
  });

  it("allows any non-terminal status to move to FAILED", () => {
    expect(() => assertValidTransition("INBOUND", "VALIDATING", "FAILED")).not.toThrow();
  });

  it("allows PREPARING -> READY for outbound", () => {
    expect(() => assertValidTransition("OUTBOUND", "PREPARING", "READY")).not.toThrow();
  });

  it("rejects READY -> PREPARING for outbound", () => {
    expect(() => assertValidTransition("OUTBOUND", "READY", "PREPARING")).toThrow(AppError);
  });
});
