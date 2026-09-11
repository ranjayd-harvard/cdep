import { describe, expect, it } from "vitest";
import { computeAlertDedupKey } from "../../domain/alerting/dedup-key.js";

describe("computeAlertDedupKey", () => {
  it("is deterministic for the same inputs", () => {
    const params = {
      tenantId: "tenant-default-47d849",
      dataProductId: "event-performance",
      productVersion: "1.3.0",
      alertType: "PUBLICATION_FAILED" as const,
      scopeKey: "oexec-1",
    };
    expect(computeAlertDedupKey(params)).toBe(computeAlertDedupKey(params));
  });

  it("differs when any scoping field differs", () => {
    const base = {
      tenantId: "tenant-default-47d849",
      dataProductId: "event-performance",
      productVersion: "1.3.0",
      alertType: "PUBLICATION_FAILED" as const,
      scopeKey: "oexec-1",
    };
    expect(computeAlertDedupKey(base)).not.toBe(computeAlertDedupKey({ ...base, scopeKey: "oexec-2" }));
    expect(computeAlertDedupKey(base)).not.toBe(computeAlertDedupKey({ ...base, productVersion: "1.4.0" }));
  });
});
