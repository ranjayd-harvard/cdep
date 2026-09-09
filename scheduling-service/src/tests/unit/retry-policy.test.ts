import { describe, expect, it } from "vitest";
import { calculateBackoffSeconds, isRetriableFailure, type BackoffConfig } from "../../domain/retry-policy.js";

const config: BackoffConfig = {
  initialBackoffSeconds: 30,
  maxBackoffSeconds: 900,
  multiplier: 2,
  jitterRatio: 0,
};

describe("calculateBackoffSeconds", () => {
  it("grows exponentially with attempt number (no jitter)", () => {
    expect(calculateBackoffSeconds(1, config)).toBe(30);
    expect(calculateBackoffSeconds(2, config)).toBe(60);
    expect(calculateBackoffSeconds(3, config)).toBe(120);
    expect(calculateBackoffSeconds(4, config)).toBe(240);
  });

  it("caps at maxBackoffSeconds", () => {
    expect(calculateBackoffSeconds(10, config)).toBe(900);
  });

  it("applies jitter within the configured ratio", () => {
    const jittered: BackoffConfig = { ...config, jitterRatio: 0.2 };
    // Deterministic random: always returns 1 -> maximum positive jitter.
    const withMaxJitter = calculateBackoffSeconds(2, jittered, () => 1);
    expect(withMaxJitter).toBe(Math.round(60 + 60 * 0.2));
    // Deterministic random: always returns 0 -> maximum negative jitter.
    const withMinJitter = calculateBackoffSeconds(2, jittered, () => 0);
    expect(withMinJitter).toBe(Math.round(60 - 60 * 0.2));
  });

  it("never returns a negative delay", () => {
    const jittered: BackoffConfig = { ...config, initialBackoffSeconds: 1, jitterRatio: 1 };
    expect(calculateBackoffSeconds(1, jittered, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("isRetriableFailure", () => {
  it("treats transient/database/internal/timeout failures as retriable", () => {
    expect(isRetriableFailure("TRANSIENT_DEPENDENCY_FAILURE")).toBe(true);
    expect(isRetriableFailure("DATABASE_FAILURE")).toBe(true);
    expect(isRetriableFailure("INTERNAL_FAILURE")).toBe(true);
    expect(isRetriableFailure("PUBLICATION_TIMEOUT")).toBe(true);
  });

  it("never retries policy denials or permanent configuration problems", () => {
    expect(isRetriableFailure("ACCESS_DENIED")).toBe(false);
    expect(isRetriableFailure("PERMANENT_CONFIGURATION_FAILURE")).toBe(false);
    expect(isRetriableFailure("PRODUCT_UNAVAILABLE")).toBe(false);
    expect(isRetriableFailure("PUBLICATION_REJECTED")).toBe(false);
  });
});
