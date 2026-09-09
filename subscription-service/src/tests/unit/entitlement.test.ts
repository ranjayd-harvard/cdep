import { describe, expect, it } from "vitest";
import { evaluateEntitlement, type Entitlement } from "../../domain/entitlement.js";

const ORG = "org-1";
const TENANT = "tenant-1";
const PRODUCT = "prod-1";
const NOW = new Date("2026-09-08T00:00:00Z");

function baseEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    entitlementId: "ent-1",
    organizationId: ORG,
    tenantId: TENANT,
    dataProductId: PRODUCT,
    effect: "ALLOW",
    validFrom: null,
    validUntil: null,
    reason: null,
    revokedAt: null,
    revokedBy: null,
    version: 1,
    ...overrides,
  };
}

describe("evaluateEntitlement", () => {
  it("denies with NO_ENTITLEMENT when there is no entitlement row", () => {
    const result = evaluateEntitlement(null, ORG, TENANT, PRODUCT, NOW);
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("NO_ENTITLEMENT");
    expect(result.entitlementId).toBeNull();
  });

  it("denies with EXPLICIT_DENY for a DENY effect, even if previously revoked", () => {
    const revoked = evaluateEntitlement(
      baseEntitlement({ effect: "DENY", revokedAt: NOW, revokedBy: "admin" }),
      ORG,
      TENANT,
      PRODUCT,
      NOW,
    );
    expect(revoked.decision).toBe("DENY");
    expect(revoked.reason).toBe("EXPLICIT_DENY");
  });

  it("denies with EXPLICIT_DENY for a DENY effect", () => {
    const result = evaluateEntitlement(baseEntitlement({ effect: "DENY" }), ORG, TENANT, PRODUCT, NOW);
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("EXPLICIT_DENY");
    expect(result.entitlementId).toBe("ent-1");
  });

  it("denies with NOT_YET_VALID before valid_from", () => {
    const future = new Date("2027-01-01T00:00:00Z");
    const result = evaluateEntitlement(baseEntitlement({ validFrom: future }), ORG, TENANT, PRODUCT, NOW);
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("NOT_YET_VALID");
  });

  it("denies with EXPIRED after valid_until", () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const result = evaluateEntitlement(baseEntitlement({ validUntil: past }), ORG, TENANT, PRODUCT, NOW);
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("EXPIRED");
  });

  it("allows with ACTIVE_ENTITLEMENT for a current valid ALLOW", () => {
    const result = evaluateEntitlement(baseEntitlement(), ORG, TENANT, PRODUCT, NOW);
    expect(result.decision).toBe("ALLOW");
    expect(result.reason).toBe("ACTIVE_ENTITLEMENT");
    expect(result.entitlementId).toBe("ent-1");
  });

  it("allows within an open-ended validity window", () => {
    const result = evaluateEntitlement(
      baseEntitlement({ validFrom: new Date("2026-01-01T00:00:00Z"), validUntil: null }),
      ORG,
      TENANT,
      PRODUCT,
      NOW,
    );
    expect(result.decision).toBe("ALLOW");
  });
});
