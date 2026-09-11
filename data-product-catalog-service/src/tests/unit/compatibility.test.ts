import { describe, expect, it } from "vitest";
import {
  assessCompatibility,
  type CompatibilityField,
  type CompatibilityInput,
  type DeliverySnapshot,
  type QualitySnapshot,
  type SlaSnapshot,
} from "../../modules/compatibility/compatibility.service.js";
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
    pii: false,
    ...overrides,
  };
}

// Thin wrapper matching the pre-Phase-10 two-arg call shape, for the
// schema-only test cases below — real callers (registration.service.ts)
// build the full CompatibilityInput including quality/sla/delivery.
function assess(previousFields: CompatibilityField[] | null, nextFields: SchemaFieldInput[]) {
  return assessCompatibility({
    previous: previousFields ? { fields: previousFields } : null,
    next: { fields: nextFields },
  });
}

describe("assessCompatibility — schema diff", () => {
  it("treats a first-ever version as NON_BREAKING", () => {
    const result = assess(null, [field({ name: "event_id", type: "string", required: true, grainKey: true })]);
    expect(result.level).toBe("NON_BREAKING");
  });

  it("classifies adding a nullable customer-visible field as NON_BREAKING", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_id", type: "string", required: true }),
      field({ name: "event_date", type: "date", required: true }),
      field({ name: "revenue_per_ticket", type: "decimal(18,2)", required: false }),
    ];
    expect(assess(baseline, next).level).toBe("NON_BREAKING");
  });

  it("classifies removing a published field as BREAKING", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    const result = assess(baseline, next);
    expect(result.level).toBe("BREAKING");
    expect(result.changes.some((c) => c.type === "FIELD_REMOVED" && c.field === "venue_id")).toBe(true);
  });

  it("classifies renaming a field as BREAKING (old removed + new required added)", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_identifier", type: "string", required: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    expect(assess(baseline, next).level).toBe("BREAKING");
  });

  it("classifies an incompatible type change as BREAKING", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_id", type: "long", required: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    const result = assess(baseline, next);
    expect(result.level).toBe("BREAKING");
    expect(result.changes.some((c) => c.type === "FIELD_TYPE_CHANGED")).toBe(true);
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
    expect(assess(nullableBaseline, next).level).toBe("BREAKING");
  });

  it("classifies pure documentation changes as METADATA_ONLY", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true, description: "Primary event identifier" }),
      field({ name: "venue_id", type: "string", required: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    expect(assess(baseline, next).level).toBe("METADATA_ONLY");
  });
});

describe("assessCompatibility — grain/key diff", () => {
  it("flags a grain-key composition change as BREAKING even with no other field diffs", () => {
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: false }),
      field({ name: "venue_id", type: "string", required: true, grainKey: true }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    const result = assess(baseline, next);
    expect(result.level).toBe("BREAKING");
    expect(result.changes.some((c) => c.type === "GRAIN_CHANGED")).toBe(true);
  });

  it("flags a business-key composition change as BREAKING", () => {
    const withBusinessKey: CompatibilityField[] = baseline.map((f) => (f.fieldName === "venue_id" ? { ...f, businessKey: true } : f));
    const next: SchemaFieldInput[] = [
      field({ name: "event_id", type: "string", required: true, grainKey: true }),
      field({ name: "venue_id", type: "string", required: true, businessKey: false }),
      field({ name: "event_date", type: "date", required: true }),
    ];
    const result = assess(withBusinessKey, next);
    expect(result.level).toBe("BREAKING");
    expect(result.changes.some((c) => c.type === "KEY_CHANGED")).toBe(true);
  });
});

describe("assessCompatibility — quality contract diff", () => {
  const nextFields: SchemaFieldInput[] = baseline.map((f) => field({ name: f.fieldName, type: f.dataType, required: true, grainKey: f.grainKey }));

  function withQuality(prevQuality: QualitySnapshot, nextQuality: QualitySnapshot) {
    const input: CompatibilityInput = {
      previous: { fields: baseline, quality: prevQuality },
      next: { fields: nextFields, quality: nextQuality },
    };
    return assessCompatibility(input);
  }

  it("flags a tightened completeness threshold as NON_BREAKING but visible", () => {
    const result = withQuality(
      { minimumCompletenessPercent: 95, grainUniqueRequired: false },
      { minimumCompletenessPercent: 99, grainUniqueRequired: false },
    );
    expect(result.level).toBe("NON_BREAKING");
    expect(result.changes.some((c) => c.type === "QUALITY_RULE_ADDED")).toBe(true);
  });

  it("flags a loosened completeness threshold as visible but still non-breaking", () => {
    const result = withQuality(
      { minimumCompletenessPercent: 99, grainUniqueRequired: false },
      { minimumCompletenessPercent: 90, grainUniqueRequired: false },
    );
    expect(result.level).toBe("NON_BREAKING");
    expect(result.changes.some((c) => c.type === "QUALITY_RULE_REMOVED")).toBe(true);
  });
});

describe("assessCompatibility — SLA diff", () => {
  const nextFields: SchemaFieldInput[] = baseline.map((f) => field({ name: f.fieldName, type: f.dataType, required: true, grainKey: f.grainKey }));

  function withSla(prevSla: SlaSnapshot, nextSla: SlaSnapshot) {
    return assessCompatibility({
      previous: { fields: baseline, sla: prevSla },
      next: { fields: nextFields, sla: nextSla },
    });
  }

  it("flags a tighter freshness target as SLA_IMPROVED and non-breaking", () => {
    const result = withSla({ freshnessMinutes: 240 }, { freshnessMinutes: 120 });
    expect(result.level).toBe("NON_BREAKING");
    expect(result.changes.some((c) => c.type === "SLA_IMPROVED")).toBe(true);
  });

  it("flags a looser freshness target as SLA_LOOSENED, still non-breaking but visible", () => {
    const result = withSla({ freshnessMinutes: 240 }, { freshnessMinutes: 720 });
    expect(result.level).toBe("NON_BREAKING");
    expect(result.changes.some((c) => c.type === "SLA_LOOSENED")).toBe(true);
  });

  it("flags a lowered availability target as SLA_LOOSENED", () => {
    const result = withSla({ availabilityTargetPercent: 99.9 }, { availabilityTargetPercent: 99.0 });
    expect(result.changes.some((c) => c.type === "SLA_LOOSENED")).toBe(true);
  });
});

describe("assessCompatibility — delivery method diff", () => {
  const nextFields: SchemaFieldInput[] = baseline.map((f) => field({ name: f.fieldName, type: f.dataType, required: true, grainKey: f.grainKey }));

  function withDelivery(prev: DeliverySnapshot[], next: DeliverySnapshot[]) {
    return assessCompatibility({
      previous: { fields: baseline, delivery: prev },
      next: { fields: nextFields, delivery: next },
    });
  }

  it("classifies removing a published delivery method as BREAKING", () => {
    const result = withDelivery(
      [
        { method: "PARQUET", enabled: true },
        { method: "CSV", enabled: true },
        { method: "API", enabled: true },
      ],
      [
        { method: "PARQUET", enabled: true },
        { method: "API", enabled: true },
      ],
    );
    expect(result.level).toBe("BREAKING");
    expect(result.changes.some((c) => c.type === "DELIVERY_METHOD_REMOVED" && c.method === "CSV")).toBe(true);
  });

  it("classifies adding a delivery method as NON_BREAKING", () => {
    const result = withDelivery(
      [{ method: "PARQUET", enabled: true }],
      [
        { method: "PARQUET", enabled: true },
        { method: "JSON", enabled: true },
      ],
    );
    expect(result.level).toBe("NON_BREAKING");
    expect(result.changes.some((c) => c.type === "DELIVERY_METHOD_ADDED" && c.method === "JSON")).toBe(true);
  });

  it("classifies removing a supported API filter as BREAKING", () => {
    const result = withDelivery(
      [{ method: "API", enabled: true, filters: ["venue_id", "event_date"] }],
      [{ method: "API", enabled: true, filters: ["event_date"] }],
    );
    expect(result.level).toBe("BREAKING");
    expect(result.changes.some((c) => c.type === "API_FILTER_REMOVED" && c.filter === "venue_id")).toBe(true);
  });

  it("classifies adding a supported API filter as NON_BREAKING", () => {
    const result = withDelivery(
      [{ method: "API", enabled: true, filters: ["event_date"] }],
      [{ method: "API", enabled: true, filters: ["event_date", "venue_id"] }],
    );
    expect(result.level).toBe("NON_BREAKING");
    expect(result.changes.some((c) => c.type === "API_FILTER_ADDED" && c.filter === "venue_id")).toBe(true);
  });
});
