import { describe, expect, it } from "vitest";
import { computeContractHash, canonicalJson } from "../../registration/contract-hash.js";

describe("computeContractHash", () => {
  it("is stable across key ordering", () => {
    const a = { metadata: { id: "x", version: "1.0.0" }, spec: { domain: { id: "events" } } };
    const b = { spec: { domain: { id: "events" } }, metadata: { version: "1.0.0", id: "x" } };
    expect(computeContractHash(a)).toBe(computeContractHash(b));
  });

  it("changes when semantic content changes", () => {
    const a = { metadata: { id: "x", version: "1.0.0" } };
    const b = { metadata: { id: "x", version: "1.0.1" } };
    expect(computeContractHash(a)).not.toBe(computeContractHash(b));
  });

  it("preserves array order in the canonical form (schema field order is meaningful)", () => {
    const a = canonicalJson({ schema: [{ name: "a" }, { name: "b" }] });
    const b = canonicalJson({ schema: [{ name: "b" }, { name: "a" }] });
    expect(a).not.toBe(b);
  });

  it("ignores undefined fields", () => {
    const a = computeContractHash({ x: 1, y: undefined });
    const b = computeContractHash({ x: 1 });
    expect(a).toBe(b);
  });

  it("produces a 64-character hex sha256 digest", () => {
    const hash = computeContractHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
