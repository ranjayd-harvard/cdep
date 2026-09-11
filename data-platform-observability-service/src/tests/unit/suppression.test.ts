import { describe, expect, it } from "vitest";
import { isSuppressedByMaintenanceWindow, isSuppressedUntil } from "../../domain/alerting/suppression.js";

const scope = { serviceName: "data-publication-service", dataProductId: "event-performance", productVersion: "1.3.0", tenantId: "tenant-default-47d849" };
const now = new Date("2026-09-09T05:30:00Z");

describe("isSuppressedByMaintenanceWindow", () => {
  it("suppresses everything during a PLATFORM window", () => {
    const windows = [{ scope: "PLATFORM" as const, scopeValue: null, startsAt: new Date("2026-09-09T05:00:00Z"), endsAt: new Date("2026-09-09T06:00:00Z") }];
    expect(isSuppressedByMaintenanceWindow(windows, scope, now)).toBe(true);
  });

  it("only suppresses a matching PRODUCT_VERSION window", () => {
    const windows = [{ scope: "PRODUCT_VERSION" as const, scopeValue: "event-performance:1.3.0", startsAt: new Date("2026-09-09T05:00:00Z"), endsAt: new Date("2026-09-09T06:00:00Z") }];
    expect(isSuppressedByMaintenanceWindow(windows, scope, now)).toBe(true);
    expect(isSuppressedByMaintenanceWindow(windows, { ...scope, productVersion: "2.0.0" }, now)).toBe(false);
  });

  it("does not suppress outside the window's time range", () => {
    const windows = [{ scope: "PLATFORM" as const, scopeValue: null, startsAt: new Date("2026-09-09T07:00:00Z"), endsAt: new Date("2026-09-09T08:00:00Z") }];
    expect(isSuppressedByMaintenanceWindow(windows, scope, now)).toBe(false);
  });
});

describe("isSuppressedUntil", () => {
  it("suppresses while now is before suppressedUntil", () => {
    expect(isSuppressedUntil(new Date("2026-09-09T06:00:00Z"), now)).toBe(true);
  });
  it("does not suppress once suppressedUntil has passed", () => {
    expect(isSuppressedUntil(new Date("2026-09-09T05:00:00Z"), now)).toBe(false);
  });
  it("does not suppress when null", () => {
    expect(isSuppressedUntil(null, now)).toBe(false);
  });
});
