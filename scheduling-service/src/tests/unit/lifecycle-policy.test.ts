import { describe, expect, it } from "vitest";
import { isLifecyclePublishable } from "../../domain/lifecycle-policy.js";

// Phase 10 §29/§40: narrowed to a DRAFT/RETIRED-only defensive check —
// Catalog's centralized resolver (intent="DELIVER") now enforces the full
// consumption-gating table before a version is ever returned, so this no
// longer needs to reproduce the EXACT-vs-floating distinction locally.
describe("isLifecyclePublishable", () => {
  it("ACTIVE is always publishable", () => {
    expect(isLifecyclePublishable("ACTIVE", "EXACT")).toBe(true);
    expect(isLifecyclePublishable("ACTIVE", "COMPATIBLE_MINOR")).toBe(true);
    expect(isLifecyclePublishable("ACTIVE", "LATEST_ACTIVE")).toBe(true);
  });

  it("DEPRECATED and BETA are publishable regardless of policy type — the resolver already gated them", () => {
    expect(isLifecyclePublishable("DEPRECATED", "EXACT")).toBe(true);
    expect(isLifecyclePublishable("BETA", "EXACT")).toBe(true);
    expect(isLifecyclePublishable("DEPRECATED", "COMPATIBLE_MINOR")).toBe(true);
    expect(isLifecyclePublishable("BETA", "LATEST_ACTIVE")).toBe(true);
  });

  it("DRAFT and RETIRED are never publishable", () => {
    expect(isLifecyclePublishable("DRAFT", "EXACT")).toBe(false);
    expect(isLifecyclePublishable("RETIRED", "EXACT")).toBe(false);
  });
});
