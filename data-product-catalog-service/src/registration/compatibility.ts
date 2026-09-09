import type { CompatibilityLevel } from "../config/constants.js";
import type { SchemaFieldInput } from "./contract-schema.js";

export interface CompatibilityField {
  fieldName: string;
  dataType: string;
  nullable: boolean;
  grainKey: boolean;
  businessKey: boolean;
  customerVisible: boolean;
}

export interface CompatibilityResult {
  level: CompatibilityLevel;
  changes: string[];
}

// Minimal, explicit, testable compatibility engine (spec §18) — deliberately
// NOT a general schema-registry framework. Compares the previously
// registered version's persisted customer-visible fields against the new
// contract's declared schema.
export function assessCompatibility(
  previousFields: CompatibilityField[] | null,
  nextFields: SchemaFieldInput[],
): CompatibilityResult {
  if (previousFields === null) {
    // First-ever version of a product: nothing to compare against.
    return { level: "NON_BREAKING", changes: ["initial version"] };
  }

  const changes: string[] = [];
  let breaking = false;
  let nonBreaking = false;

  const prevByName = new Map(previousFields.map((f) => [f.fieldName, f]));
  const nextByName = new Map(nextFields.map((f) => [f.name, f]));

  for (const prev of previousFields) {
    const next = nextByName.get(prev.fieldName);
    if (!next) {
      if (prev.customerVisible) {
        breaking = true;
        changes.push(`removed published field '${prev.fieldName}'`);
      } else {
        changes.push(`removed internal-only field '${prev.fieldName}'`);
      }
      continue;
    }

    if (next.type !== prev.dataType) {
      breaking = true;
      changes.push(`changed type of '${prev.fieldName}' from ${prev.dataType} to ${next.type}`);
    }

    // A field going from nullable to required is breaking for existing
    // consumers who may not populate it; the reverse (required -> nullable)
    // is safe.
    const nextNullable = !next.required;
    if (prev.nullable && !nextNullable) {
      breaking = true;
      changes.push(`made '${prev.fieldName}' required (was optional)`);
    }

    if (prev.grainKey !== next.grainKey) {
      breaking = true;
      changes.push(`changed grain-key status of '${prev.fieldName}'`);
    }

    if (prev.customerVisible !== next.customerVisible) {
      breaking = true;
      changes.push(`changed customer-visibility of '${prev.fieldName}'`);
    }

    if (next.description !== undefined) {
      // description/documentation-only differences don't move the needle
      // past METADATA_ONLY on their own.
      changes.push(`updated description of '${prev.fieldName}'`);
    }
  }

  for (const next of nextFields) {
    if (!prevByName.has(next.name)) {
      if (next.customerVisible && next.required) {
        breaking = true;
        changes.push(`added required customer-visible field '${next.name}' (existing consumers won't supply it)`);
      } else {
        nonBreaking = true;
        changes.push(`added optional field '${next.name}'`);
      }
    }
  }

  if (breaking) return { level: "BREAKING", changes };
  if (nonBreaking) return { level: "NON_BREAKING", changes };
  return { level: "METADATA_ONLY", changes: changes.length > 0 ? changes : ["no schema-affecting changes"] };
}
