import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, filterFingerprint, type CursorPayload } from "../../domain/cursor.js";
import { AppError } from "../../common/errors/app-error.js";

const SECRET = "test-secret-at-least-16-chars";

const PAYLOAD: CursorPayload = {
  organizationId: "org-a",
  tenantId: "tenant-a",
  productId: "event-performance",
  productVersion: "1.0.0",
  sort: ["event_date", "event_id"],
  filterFingerprint: filterFingerprint({ venueId: "VEN001" }),
  lastValues: { event_date: "2026-09-01", event_id: "EVT1001" },
};

describe("cursor", () => {
  it("round-trips a valid cursor", () => {
    const encoded = encodeCursor(PAYLOAD, SECRET);
    const decoded = decodeCursor(encoded, SECRET);
    expect(decoded).toEqual(PAYLOAD);
  });

  it("rejects a cursor signed with a different secret", () => {
    const encoded = encodeCursor(PAYLOAD, SECRET);
    expect(() => decodeCursor(encoded, "a-completely-different-secret")).toThrow(AppError);
  });

  it("rejects a tampered payload even with a matching-length forged signature", () => {
    const encoded = encodeCursor(PAYLOAD, SECRET);
    const [payloadB64] = encoded.split(".");
    const tamperedPayload = JSON.stringify({ ...PAYLOAD, tenantId: "tenant-b" });
    const tamperedB64 = Buffer.from(tamperedPayload, "utf8").toString("base64url");
    const forged = `${tamperedB64}.${encoded.split(".")[1]}`;
    expect(payloadB64).toBeDefined();
    expect(() => decodeCursor(forged, SECRET)).toThrow(AppError);
  });

  it("rejects a malformed cursor string", () => {
    expect(() => decodeCursor("not-a-valid-cursor", SECRET)).toThrow(AppError);
    expect(() => decodeCursor("a.b.c", SECRET)).toThrow(AppError);
  });

  it("filterFingerprint ignores key order and undefined values", () => {
    const a = filterFingerprint({ eventId: "E1", venueId: undefined });
    const b = filterFingerprint({ venueId: undefined, eventId: "E1" });
    expect(a).toBe(b);
  });

  it("filterFingerprint changes when a filter value changes", () => {
    const a = filterFingerprint({ eventId: "E1" });
    const b = filterFingerprint({ eventId: "E2" });
    expect(a).not.toBe(b);
  });
});
