import type { CompatibilityLevel } from "../../config/constants.js";
import type { SchemaFieldInput } from "../../registration/contract-schema.js";

export interface CompatibilityField {
  fieldName: string;
  dataType: string;
  nullable: boolean;
  grainKey: boolean;
  businessKey: boolean;
  customerVisible: boolean;
}

// Phase 10 §15: closed vocabulary of diff-entry types, shared by every
// comparison pass below and persisted verbatim into
// catalog.version_compatibility_results.changes (structured, never a bare
// compatible=true/false — spec §12/§65's "explainable" requirement).
export type CompatibilityChangeType =
  | "FIELD_ADDED"
  | "FIELD_REMOVED"
  | "FIELD_TYPE_CHANGED"
  | "FIELD_MADE_REQUIRED"
  | "FIELD_VISIBILITY_CHANGED"
  | "GRAIN_CHANGED"
  | "KEY_CHANGED"
  | "QUALITY_RULE_ADDED"
  | "QUALITY_RULE_REMOVED"
  | "SLA_IMPROVED"
  | "SLA_LOOSENED"
  | "DELIVERY_METHOD_REMOVED"
  | "DELIVERY_METHOD_ADDED"
  | "API_FILTER_REMOVED"
  | "API_FILTER_ADDED"
  | "API_FIELD_REMOVED"
  | "DOCUMENTATION_CHANGED";

export interface CompatibilityChange {
  type: CompatibilityChangeType;
  field?: string;
  method?: string;
  filter?: string;
  detail: string;
}

export interface CompatibilityResult {
  level: CompatibilityLevel;
  changes: CompatibilityChange[];
}

export interface QualitySnapshot {
  minimumCompletenessPercent?: number | null;
  maximumInvalidPercent?: number | null;
  grainUniqueRequired: boolean;
  rules?: Record<string, unknown> | null;
}

export interface SlaSnapshot {
  freshnessMinutes?: number | null;
  availabilityTargetPercent?: number | null;
  deliveryDeadlineExpression?: string | null;
  maximumPublicationLatencyMinutes?: number | null;
}

export interface DeliverySnapshot {
  method: string;
  enabled: boolean;
  filters?: string[];
  sorts?: string[];
}

export interface CompatibilitySide {
  fields: CompatibilityField[];
  quality?: QualitySnapshot | null;
  sla?: SlaSnapshot | null;
  delivery?: DeliverySnapshot[] | null;
}

export interface CompatibilityInput {
  // null previous = first-ever version of the product: nothing to compare.
  previous: CompatibilitySide | null;
  next: {
    fields: SchemaFieldInput[];
    quality?: QualitySnapshot | null;
    sla?: SlaSnapshot | null;
    delivery?: DeliverySnapshot[] | null;
  };
}

function rollup(changes: CompatibilityChange[], breaking: boolean, nonBreaking: boolean): CompatibilityResult {
  if (breaking) return { level: "BREAKING", changes };
  if (nonBreaking) return { level: "NON_BREAKING", changes };
  return {
    level: "METADATA_ONLY",
    changes: changes.length > 0 ? changes : [{ type: "DOCUMENTATION_CHANGED", detail: "no schema-affecting changes" }],
  };
}

// Field-level + grain-set diff (spec §13's core pass, extended with the
// set-level grain check). Previously lived alone as `assessCompatibility`;
// now one pass among several, still the dominant one in practice.
function diffSchema(previousFields: CompatibilityField[], nextFields: SchemaFieldInput[]): { changes: CompatibilityChange[]; breaking: boolean; nonBreaking: boolean } {
  const changes: CompatibilityChange[] = [];
  let breaking = false;
  let nonBreaking = false;

  const prevByName = new Map(previousFields.map((f) => [f.fieldName, f]));
  const nextByName = new Map(nextFields.map((f) => [f.name, f]));

  for (const prev of previousFields) {
    const next = nextByName.get(prev.fieldName);
    if (!next) {
      breaking = breaking || prev.customerVisible;
      changes.push({
        type: "FIELD_REMOVED",
        field: prev.fieldName,
        detail: prev.customerVisible
          ? `removed published field '${prev.fieldName}'`
          : `removed internal-only field '${prev.fieldName}'`,
      });
      continue;
    }

    if (next.type !== prev.dataType) {
      breaking = true;
      changes.push({
        type: "FIELD_TYPE_CHANGED",
        field: prev.fieldName,
        detail: `changed type of '${prev.fieldName}' from ${prev.dataType} to ${next.type}`,
      });
    }

    const nextNullable = !next.required;
    if (prev.nullable && !nextNullable) {
      breaking = true;
      changes.push({
        type: "FIELD_MADE_REQUIRED",
        field: prev.fieldName,
        detail: `made '${prev.fieldName}' required (was optional)`,
      });
    }

    if (prev.customerVisible !== next.customerVisible) {
      breaking = true;
      changes.push({
        type: "FIELD_VISIBILITY_CHANGED",
        field: prev.fieldName,
        detail: `changed customer-visibility of '${prev.fieldName}'`,
      });
    }

    if (next.description !== undefined) {
      changes.push({
        type: "DOCUMENTATION_CHANGED",
        field: prev.fieldName,
        detail: `updated description of '${prev.fieldName}'`,
      });
    }
  }

  for (const next of nextFields) {
    if (!prevByName.has(next.name)) {
      if (next.customerVisible && next.required) {
        breaking = true;
        changes.push({
          type: "FIELD_MADE_REQUIRED",
          field: next.name,
          detail: `added required customer-visible field '${next.name}' (existing consumers won't supply it)`,
        });
      } else {
        nonBreaking = true;
        changes.push({ type: "FIELD_ADDED", field: next.name, detail: `added optional field '${next.name}'` });
      }
    }
  }

  // Grain-key SET diff: if the field-composition of the grain changed at
  // all, that's BREAKING regardless of the individual per-field diffs
  // above, since the grain is the contract's identity (spec §13).
  const prevGrain = new Set(previousFields.filter((f) => f.grainKey).map((f) => f.fieldName));
  const nextGrain = new Set(nextFields.filter((f) => f.grainKey).map((f) => f.name));
  if (prevGrain.size !== nextGrain.size || [...prevGrain].some((f) => !nextGrain.has(f))) {
    breaking = true;
    changes.push({
      type: "GRAIN_CHANGED",
      detail: `grain-key fields changed from {${[...prevGrain].join(", ")}} to {${[...nextGrain].join(", ")}}`,
    });
  }

  const prevKeys = new Set(previousFields.filter((f) => f.businessKey).map((f) => f.fieldName));
  const nextKeys = new Set(nextFields.filter((f) => f.businessKey).map((f) => f.name));
  if (prevKeys.size !== nextKeys.size || [...prevKeys].some((f) => !nextKeys.has(f))) {
    breaking = true;
    changes.push({
      type: "KEY_CHANGED",
      detail: `business-key fields changed from {${[...prevKeys].join(", ")}} to {${[...nextKeys].join(", ")}}`,
    });
  }

  return { changes, breaking, nonBreaking };
}

// Quality contract diff (spec §13/§15): every change here is NON_BREAKING
// for the producer's own version-bump requirement — a tightened rule can't
// retroactively break an existing consumer's already-flowing data — but
// every change is still surfaced for visibility/approval review, never
// silently dropped.
function diffQuality(prev: QualitySnapshot | null | undefined, next: QualitySnapshot | null | undefined): CompatibilityChange[] {
  if (!prev || !next) return [];
  const changes: CompatibilityChange[] = [];

  if ((prev.minimumCompletenessPercent ?? null) !== (next.minimumCompletenessPercent ?? null)) {
    const tightened = (next.minimumCompletenessPercent ?? 0) > (prev.minimumCompletenessPercent ?? 0);
    changes.push({
      type: tightened ? "QUALITY_RULE_ADDED" : "QUALITY_RULE_REMOVED",
      detail: `minimumCompletenessPercent changed from ${prev.minimumCompletenessPercent ?? "unset"} to ${next.minimumCompletenessPercent ?? "unset"}`,
    });
  }
  if ((prev.maximumInvalidPercent ?? null) !== (next.maximumInvalidPercent ?? null)) {
    const tightened = (next.maximumInvalidPercent ?? Infinity) < (prev.maximumInvalidPercent ?? Infinity);
    changes.push({
      type: tightened ? "QUALITY_RULE_ADDED" : "QUALITY_RULE_REMOVED",
      detail: `maximumInvalidPercent changed from ${prev.maximumInvalidPercent ?? "unset"} to ${next.maximumInvalidPercent ?? "unset"}`,
    });
  }
  if (Boolean(prev.grainUniqueRequired) !== Boolean(next.grainUniqueRequired)) {
    changes.push({
      type: next.grainUniqueRequired ? "QUALITY_RULE_ADDED" : "QUALITY_RULE_REMOVED",
      detail: `grainUniqueRequired changed from ${Boolean(prev.grainUniqueRequired)} to ${Boolean(next.grainUniqueRequired)}`,
    });
  }
  const prevRuleKeys = new Set(Object.keys(prev.rules ?? {}));
  const nextRuleKeys = new Set(Object.keys(next.rules ?? {}));
  for (const key of nextRuleKeys) {
    if (!prevRuleKeys.has(key)) changes.push({ type: "QUALITY_RULE_ADDED", field: key, detail: `added quality rule '${key}'` });
  }
  for (const key of prevRuleKeys) {
    if (!nextRuleKeys.has(key)) changes.push({ type: "QUALITY_RULE_REMOVED", field: key, detail: `removed quality rule '${key}'` });
  }
  return changes;
}

// SLA diff (spec §16): also always NON_BREAKING by itself — a loosened SLA
// isn't rejected, but it must never be silently invisible either, so a
// loosening always emits an SLA_LOOSENED entry for the approval/impact
// review to see.
function diffSla(prev: SlaSnapshot | null | undefined, next: SlaSnapshot | null | undefined): CompatibilityChange[] {
  if (!prev || !next) return [];
  const changes: CompatibilityChange[] = [];

  const compareLowerIsBetter = (label: string, prevVal?: number | null, nextVal?: number | null) => {
    if ((prevVal ?? null) === (nextVal ?? null)) return;
    const improved = (nextVal ?? Infinity) < (prevVal ?? Infinity);
    changes.push({
      type: improved ? "SLA_IMPROVED" : "SLA_LOOSENED",
      detail: `${label} changed from ${prevVal ?? "unset"} to ${nextVal ?? "unset"}`,
    });
  };
  const compareHigherIsBetter = (label: string, prevVal?: number | null, nextVal?: number | null) => {
    if ((prevVal ?? null) === (nextVal ?? null)) return;
    const improved = (nextVal ?? 0) > (prevVal ?? 0);
    changes.push({
      type: improved ? "SLA_IMPROVED" : "SLA_LOOSENED",
      detail: `${label} changed from ${prevVal ?? "unset"} to ${nextVal ?? "unset"}`,
    });
  };

  compareLowerIsBetter("freshnessMinutes", prev.freshnessMinutes, next.freshnessMinutes);
  compareHigherIsBetter("availabilityTargetPercent", prev.availabilityTargetPercent, next.availabilityTargetPercent);
  compareLowerIsBetter("maximumPublicationLatencyMinutes", prev.maximumPublicationLatencyMinutes, next.maximumPublicationLatencyMinutes);
  if ((prev.deliveryDeadlineExpression ?? null) !== (next.deliveryDeadlineExpression ?? null)) {
    changes.push({
      type: "SLA_LOOSENED",
      detail: `deliveryDeadlineExpression changed from '${prev.deliveryDeadlineExpression ?? "unset"}' to '${next.deliveryDeadlineExpression ?? "unset"}'`,
    });
  }
  return changes;
}

// Delivery-method + API filter/sort diff (spec §17/§19). Removing a
// previously-published method or filter/sort is BREAKING; adding one is
// NON_BREAKING.
function diffDelivery(
  prev: DeliverySnapshot[] | null | undefined,
  next: DeliverySnapshot[] | null | undefined,
): { changes: CompatibilityChange[]; breaking: boolean; nonBreaking: boolean } {
  const changes: CompatibilityChange[] = [];
  let breaking = false;
  let nonBreaking = false;
  if (!prev || !next) return { changes, breaking, nonBreaking };

  const prevEnabled = new Map(prev.filter((m) => m.enabled).map((m) => [m.method, m]));
  const nextEnabled = new Map(next.filter((m) => m.enabled).map((m) => [m.method, m]));

  for (const [method] of prevEnabled) {
    if (!nextEnabled.has(method)) {
      breaking = true;
      changes.push({ type: "DELIVERY_METHOD_REMOVED", method, detail: `removed published delivery method '${method}'` });
    }
  }
  for (const [method] of nextEnabled) {
    if (!prevEnabled.has(method)) {
      nonBreaking = true;
      changes.push({ type: "DELIVERY_METHOD_ADDED", method, detail: `added delivery method '${method}'` });
    }
  }

  const prevApi = prevEnabled.get("API");
  const nextApi = nextEnabled.get("API");
  if (prevApi && nextApi) {
    const prevFilters = new Set(prevApi.filters ?? []);
    const nextFilters = new Set(nextApi.filters ?? []);
    for (const filter of prevFilters) {
      if (!nextFilters.has(filter)) {
        breaking = true;
        changes.push({ type: "API_FILTER_REMOVED", filter, detail: `removed API filter '${filter}'` });
      }
    }
    for (const filter of nextFilters) {
      if (!prevFilters.has(filter)) {
        nonBreaking = true;
        changes.push({ type: "API_FILTER_ADDED", filter, detail: `added API filter '${filter}'` });
      }
    }
    const prevSorts = new Set(prevApi.sorts ?? []);
    const nextSorts = new Set(nextApi.sorts ?? []);
    for (const sort of prevSorts) {
      if (!nextSorts.has(sort)) {
        breaking = true;
        changes.push({ type: "API_FILTER_REMOVED", filter: sort, detail: `removed API sort '${sort}'` });
      }
    }
    for (const sort of nextSorts) {
      if (!prevSorts.has(sort)) {
        nonBreaking = true;
        changes.push({ type: "API_FILTER_ADDED", filter: sort, detail: `added API sort '${sort}'` });
      }
    }
  }

  return { changes, breaking, nonBreaking };
}

// Minimal, explicit, testable compatibility engine (spec §13-§19) —
// deliberately NOT a general schema-registry framework. Compares the
// previously registered version's persisted state against the proposed
// contract across schema, grain/keys, quality, SLA, delivery methods, and
// API filters/sorts, folding every pass into one changes[] array and one
// overall breaking/non-breaking/metadata-only rollup.
export function assessCompatibility(input: CompatibilityInput): CompatibilityResult {
  if (input.previous === null) {
    return { level: "NON_BREAKING", changes: [{ type: "DOCUMENTATION_CHANGED", detail: "initial version" }] };
  }

  const schema = diffSchema(input.previous.fields, input.next.fields);
  const delivery = diffDelivery(input.previous.delivery, input.next.delivery);
  const quality = diffQuality(input.previous.quality, input.next.quality);
  const sla = diffSla(input.previous.sla, input.next.sla);

  const changes = [...schema.changes, ...delivery.changes, ...quality, ...sla];
  const breaking = schema.breaking || delivery.breaking;
  // Quality/SLA changes are never breaking by themselves (spec §16: "treat
  // any SLA loosening as NON_BREAKING"; §15: a tightened quality rule "is
  // NON_BREAKING for the producer") — but a real change to either still
  // moves the overall result at least to NON_BREAKING (a MINOR-bump-worthy
  // contract change), never leaving it at METADATA_ONLY.
  const nonBreaking = schema.nonBreaking || delivery.nonBreaking || quality.length > 0 || sla.length > 0;

  return rollup(changes, breaking, nonBreaking);
}
