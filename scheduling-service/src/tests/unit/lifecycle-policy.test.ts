import { describe, expect, it } from "vitest";
import { isLifecyclePublishable } from "../../domain/lifecycle-policy.js";

describe("isLifecyclePublishable", () => {
  it("ACTIVE is always publishable", () => {
    expect(isLifecyclePublishable("ACTIVE", "EXACT")).toBe(true);
    expect(isLifecyclePublishable("ACTIVE", "COMPATIBLE_MAJOR")).toBe(true);
    expect(isLifecyclePublishable("ACTIVE", "LATEST_ACTIVE")).toBe(true);
  });

  it("DEPRECATED/BETA are publishable only when explicitly pinned via EXACT", () => {
    expect(isLifecyclePublishable("DEPRECATED", "EXACT")).toBe(true);
    expect(isLifecyclePublishable("BETA", "EXACT")).toBe(true);
    expect(isLifecyclePublishable("DEPRECATED", "COMPATIBLE_MAJOR")).toBe(false);
    expect(isLifecyclePublishable("BETA", "LATEST_ACTIVE")).toBe(false);
  });

  it("DRAFT and RETIRED are never publishable", () => {
    expect(isLifecyclePublishable("DRAFT", "EXACT")).toBe(false);
    expect(isLifecyclePublishable("RETIRED", "EXACT")).toBe(false);
  });
});
