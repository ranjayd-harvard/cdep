import { describe, expect, it } from "vitest";
import { contractDocumentSchema } from "../../registration/contract-schema.js";
import { validateContractStructure } from "../../registration/registration.validator.js";
import { AppError } from "../../common/errors/app-error.js";

function baseDoc(overrides: Record<string, unknown> = {}) {
  return contractDocumentSchema.parse({
    apiVersion: "data-platform/v1",
    kind: "DataProduct",
    metadata: { id: "event-performance", name: "Event Performance", version: "1.0.0" },
    spec: {
      domain: { id: "events" },
      owner: { id: "event-analytics" },
      grain: { keys: ["event_id"] },
      schema: [
        { name: "event_id", type: "string", required: true, grainKey: true },
        { name: "venue_id", type: "string", required: true },
      ],
      delivery: { methods: [{ type: "FILE", enabled: true, formats: ["PARQUET"] }] },
      ...overrides,
    },
  });
}

describe("validateContractStructure", () => {
  it("accepts a well-formed contract", () => {
    expect(() => validateContractStructure(baseDoc())).not.toThrow();
  });

  it("rejects duplicate field names", () => {
    const doc = baseDoc({
      schema: [
        { name: "event_id", type: "string", required: true, grainKey: true },
        { name: "event_id", type: "string", required: true },
      ],
    });
    expect(() => validateContractStructure(doc)).toThrow(AppError);
  });

  it("rejects a grain key that isn't in the schema", () => {
    const doc = baseDoc({ grain: { keys: ["not_a_field"] }, schema: [{ name: "event_id", type: "string", required: true }] });
    expect(() => validateContractStructure(doc)).toThrow(/Grain key/);
  });

  it("rejects a FILE delivery method with no formats", () => {
    const doc = baseDoc({ delivery: { methods: [{ type: "FILE", enabled: true }] } });
    expect(() => validateContractStructure(doc)).toThrow(/format/);
  });

  it("rejects an out-of-range SLA availability target", () => {
    // Zod's own schema (0-100) already rejects this at the API boundary;
    // this exercises validateContractStructure's defense-in-depth check
    // directly, bypassing Zod, for callers that construct a document by
    // hand (e.g. future admin tooling).
    const doc = baseDoc();
    doc.spec.sla.availabilityTargetPercent = 150;
    expect(() => validateContractStructure(doc)).toThrow(/availabilityTargetPercent/);
  });

  // Phase 11 (spec §20) governance validation.
  describe("RESTRICTED field governance", () => {
    it("rejects a RESTRICTED field with no piiType", () => {
      const doc = baseDoc({
        schema: [
          { name: "event_id", type: "string", required: true, grainKey: true },
          { name: "customer_email", type: "string", classification: "RESTRICTED", maskingPolicy: "DENY" },
        ],
        governance: { retentionPolicyRef: "CUSTOMER_PII_90_DAYS" },
      });
      expect(() => validateContractStructure(doc)).toThrow(/piiType/);
    });

    it("rejects a RESTRICTED field with no maskingPolicy", () => {
      const doc = baseDoc({
        schema: [
          { name: "event_id", type: "string", required: true, grainKey: true },
          { name: "customer_email", type: "string", classification: "RESTRICTED", pii: true, piiType: "EMAIL" },
        ],
        governance: { retentionPolicyRef: "CUSTOMER_PII_90_DAYS" },
      });
      expect(() => validateContractStructure(doc)).toThrow(/maskingPolicy/);
    });

    it("rejects a RESTRICTED, customerVisible field with maskingPolicy ALLOW", () => {
      const doc = baseDoc({
        schema: [
          { name: "event_id", type: "string", required: true, grainKey: true },
          {
            name: "customer_email",
            type: "string",
            classification: "RESTRICTED",
            pii: true,
            piiType: "EMAIL",
            customerVisible: true,
            maskingPolicy: "ALLOW",
          },
        ],
        governance: { retentionPolicyRef: "CUSTOMER_PII_90_DAYS" },
      });
      expect(() => validateContractStructure(doc)).toThrow(/maskingPolicy: ALLOW/);
    });

    it("rejects a contract with a RESTRICTED field but no product-level retentionPolicyRef", () => {
      const doc = baseDoc({
        schema: [
          { name: "event_id", type: "string", required: true, grainKey: true },
          {
            name: "customer_email",
            type: "string",
            classification: "RESTRICTED",
            pii: true,
            piiType: "EMAIL",
            customerVisible: false,
            maskingPolicy: "DENY",
          },
        ],
      });
      expect(() => validateContractStructure(doc)).toThrow(/retentionPolicyRef/);
    });

    it("accepts a fully-governed RESTRICTED field", () => {
      const doc = baseDoc({
        schema: [
          { name: "event_id", type: "string", required: true, grainKey: true },
          {
            name: "customer_email",
            type: "string",
            classification: "RESTRICTED",
            pii: true,
            piiType: "EMAIL",
            customerVisible: false,
            maskingPolicy: "DENY",
          },
        ],
        governance: { retentionPolicyRef: "CUSTOMER_PII_90_DAYS" },
      });
      expect(() => validateContractStructure(doc)).not.toThrow();
    });
  });
});
