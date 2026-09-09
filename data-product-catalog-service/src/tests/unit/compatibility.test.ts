import { describe, expect, it } from "vitest";
import { assessCompatibility, type CompatibilityField } from "../../registration/compatibility.js";
import type { SchemaFieldInput } from "../../registration/contract-schema.js";

const baseline: CompatibilityField[] = [
  { fieldName: "event_id", dataType: "string", nullable: false, grainKey: true, businessKey: false, customerVisible: true },
  { fieldName: "venue_id", dataType: "string", nullable: false, grainKey: false, businessKey: false, customerVisible: true },
  { fieldName: "event_date", dataType: "date", nullable: false, grainKey: false, businessKey: false, customerVisible: true },
];

function field(overrides: Partial<SchemaFieldInput> & { name: string; type: string }): SchemaFieldInput {
  return {
    required: false,
    grainKey: false,
    businessKey: false,
    customerVisible: true,
    ...overrides,
  };
}

describe("assessCompatibility", () => {
  it("treats a first-ever version as NON_BREAKING", () => {
    const result = assessCompatibility(null, [field({ name: "event_id", type: "string", required: true, grainKey: true })]);
    expect(result.level).toBe("NON_BREAKING");
  });

  it("classifies adding a nullable customer-visible field as NON_BREAKING", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_id", type: "string", required: true }),
      field({ name: "event_date", type: "date", required: true }),
      field({ name: "revenue_per_ticket", type: "decimal(18,2)", required: false }),
    ];
    expect(assessCompatibility(baseline, next).level).toBe("NON_BREAKING");
  });

  it("classifies removing a published field as BREAKING", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    expect(assessCompatibility(baseline, next).level).toBe("BREAKING");
  });

  it("classifies renaming a field as BREAKING (old removed + new required added)", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_identifier", type: "string", required: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    expect(assessCompatibility(baseline, next).level).toBe("BREAKING");
  });

  it("classifies an incompatible type change as BREAKING", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_id", type: "long", required: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    expect(assessCompatibility(baseline, next).level).toBe("BREAKING");
  });

  it("classifies making a nullable field required as BREAKING", () => {
    const nullableBaseline: CompatibilityField[] = [
      ...baseline,
      { fieldName: "tickets_sold", dataType: "long", nullable: true, grainKey: false, businessKey: false, customerVisible: true },
    ];
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_id", type: "string", required: true }),
      field({ name: "event_date", type: "date", required: true }),
      field({ name: "tickets_sold", type: "long", required: true }),
    ];
    expect(assessCompatibility(nullableBaseline, next).level).toBe("BREAKING");
  });

  it("classifies pure documentation changes as METADATA_ONLY", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true, description: "Primary event identifier" }),
      field({ name: "venue_id", type: "string", required: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    expect(assessCompatibility(baseline, next).level).toBe("METADATA_ONLY");
  });
});
