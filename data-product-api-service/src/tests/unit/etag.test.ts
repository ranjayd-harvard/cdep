import { describe, expect, it } from "vitest";
import { computeEtag } from "../../domain/etag.js";

const BASE = {
  organizationId: "org-a",
  tenantId: "tenant-a",
  productId: "event-performance",
  version: "1.0.0",
  resource: "events",
  queryFingerprint: "fp-1",
  servingSnapshot: "snap-1",
  fields: null,
  cursor: null,
};

describe("computeEtag", () => {
  it("is deterministic for identical input", () => {
    expect(computeEtag(BASE)).toBe(computeEtag({ ...BASE }));
  });

  it("changes when the serving snapshot changes", () => {
    expect(computeEtag(BASE)).not.toBe(computeEtag({ ...BASE, servingSnapshot: "snap-2" }));
  });

  it("changes when the tenant changes", () => {
    expect(computeEtag(BASE)).not.toBe(computeEtag({ ...BASE, tenantId: "tenant-b" }));
  });

  it("changes when the field projection changes", () => {
    expect(computeEtag(BASE)).not.toBe(computeEtag({ ...BASE, fields: ["event_id"] }));
  });

  it("changes when the cursor/page changes", () => {
    expect(computeEtag(BASE)).not.toBe(computeEtag({ ...BASE, cursor: "abc.def" }));
  });
});
