import { describe, expect, it } from "vitest";
import { buildManualExecutionKey, buildScheduledExecutionKey } from "../../domain/execution-key.js";

describe("buildScheduledExecutionKey", () => {
  it("is deterministic for the same subscription/occurrence/reason", () => {
    const scheduledFor = new Date("2026-09-09T06:00:00.000Z");
    const a = buildScheduledExecutionKey("sub-123", scheduledFor, "SCHEDULED");
    const b = buildScheduledExecutionKey("sub-123", scheduledFor, "SCHEDULED");
    expect(a).toBe(b);
    expect(a).toBe("sub-123|2026-09-09T06:00:00.000Z|SCHEDULED");
  });

  it("differs by reason", () => {
    const scheduledFor = new Date("2026-09-09T06:00:00.000Z");
    const scheduled = buildScheduledExecutionKey("sub-123", scheduledFor, "SCHEDULED");
    const missed = buildScheduledExecutionKey("sub-123", scheduledFor, "MISSED_RUN_RECOVERY");
    expect(scheduled).not.toBe(missed);
  });

  it("differs by occurrence", () => {
    const a = buildScheduledExecutionKey("sub-123", new Date("2026-09-09T06:00:00.000Z"), "SCHEDULED");
    const b = buildScheduledExecutionKey("sub-123", new Date("2026-09-10T06:00:00.000Z"), "SCHEDULED");
    expect(a).not.toBe(b);
  });

  it("differs by subscription", () => {
    const scheduledFor = new Date("2026-09-09T06:00:00.000Z");
    const a = buildScheduledExecutionKey("sub-123", scheduledFor, "SCHEDULED");
    const b = buildScheduledExecutionKey("sub-456", scheduledFor, "SCHEDULED");
    expect(a).not.toBe(b);
  });
});

describe("buildManualExecutionKey", () => {
  it("is deterministic for the same idempotency key", () => {
    const a = buildManualExecutionKey("sub-123", "MANUAL", "req-1");
    const b = buildManualExecutionKey("sub-123", "MANUAL", "req-1");
    expect(a).toBe(b);
  });

  it("differs for different idempotency keys, allowing distinct manual triggers", () => {
    const a = buildManualExecutionKey("sub-123", "MANUAL", "req-1");
    const b = buildManualExecutionKey("sub-123", "MANUAL", "req-2");
    expect(a).not.toBe(b);
  });

  it("differs between MANUAL and ON_DEMAND for the same idempotency key", () => {
    const a = buildManualExecutionKey("sub-123", "MANUAL", "req-1");
    const b = buildManualExecutionKey("sub-123", "ON_DEMAND", "req-1");
    expect(a).not.toBe(b);
  });
});
