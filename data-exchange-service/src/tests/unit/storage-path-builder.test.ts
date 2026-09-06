import { describe, expect, it } from "vitest";
import {
  buildInboundDataKey,
  buildInboundMetadataKey,
  buildOutboundDataKey,
} from "../../storage/storage-path-builder.js";

const FIXED_DATE = new Date("2026-09-04T12:00:00Z");

describe("storage-path-builder", () => {
  it("builds the exact inbound data key layout", () => {
    const key = buildInboundDataKey("org-1", "tenant-1", "exc-abc", "events.csv", FIXED_DATE);
    expect(key).toBe("organizations/org-1/tenants/tenant-1/uploads/2026/09/04/exc-abc/data/events.csv");
  });

  it("builds the exact inbound metadata key layout", () => {
    const key = buildInboundMetadataKey("org-1", "tenant-1", "exc-abc", "manifest.json", FIXED_DATE);
    expect(key).toBe("organizations/org-1/tenants/tenant-1/uploads/2026/09/04/exc-abc/metadata/manifest.json");
  });

  it("builds the exact outbound data key layout", () => {
    const key = buildOutboundDataKey("org-1", "tenant-1", "exc-xyz", "report.parquet", FIXED_DATE);
    expect(key).toBe("organizations/org-1/tenants/tenant-1/downloads/2026/09/04/exc-xyz/data/report.parquet");
  });
});
