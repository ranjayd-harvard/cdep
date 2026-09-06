import { generateValidationId } from "../../common/ids/id-generator.js";
import type { SupportedFileFormat } from "../../config/constants.js";
import { createExchangeValidation } from "./validation.repository.js";

export interface ValidationError {
  row: number;
  field: string;
  code: string;
}

export interface ValidationOutcome {
  status: "PASSED" | "FAILED";
  totalRecords: number | null;
  validRecords: number | null;
  invalidRecords: number | null;
  errors: ValidationError[];
}

const MAX_SAMPLED_ERRORS = 50;

// Deliberately basic content validation (AGENTS.md section 40) — this is
// NOT schema/business validation of the customer's data, only a structural
// sanity check that the file matches its declared format. Row-level detail
// is capped in-memory and in the DB; a full report belongs in object
// storage as an ERROR_REPORT file when error volume is large (not built
// for this phase, but the exchange_files.file_role already models it).
export function validateFileContent(buffer: Buffer, format: SupportedFileFormat): ValidationOutcome {
  if (buffer.length === 0) {
    return {
      status: "FAILED",
      totalRecords: 0,
      validRecords: 0,
      invalidRecords: 0,
      errors: [{ row: 0, field: "file", code: "EMPTY_FILE" }],
    };
  }

  switch (format) {
    case "CSV":
      return validateCsv(buffer);
    case "JSON":
      return validateJson(buffer);
    case "PARQUET":
      return validateParquet(buffer);
  }
}

// A naive `line.split(",")` breaks on any real-world CSV export the
// moment a field is quoted (RFC 4180 §2.5-2.7) — a description containing
// a comma, an embedded newline inside a multi-paragraph quoted field, or
// an escaped `""` standing for a literal quote all corrupt both the
// column count AND the row count under a naive splitter. This showed up
// immediately on a real Salesforce product export: quoted `Description`
// fields with commas and multi-line text made nearly every row look like
// a COLUMN_COUNT_MISMATCH, and the embedded newlines inside those same
// quoted fields fragmented single logical rows into several via the
// naive `\n`-split. This tokenizer handles quoting correctly; it is
// still not a full CSV *library* (no configurable delimiters/dialects) —
// just enough RFC 4180 to stop misclassifying valid files as invalid.
function parseCsvRows(text: string): string[][] {
  // Salesforce (among others) commonly prefixes UTF-8 exports with a BOM.
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = normalized.length;

  while (i < len) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
      continue;
    }

    switch (char) {
      case '"':
        inQuotes = true;
        i += 1;
        break;
      case ",":
        row.push(field);
        field = "";
        i += 1;
        break;
      case "\r":
        i += 1;
        break;
      case "\n":
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += 1;
        break;
      default:
        field += char;
        i += 1;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function validateCsv(buffer: Buffer): ValidationOutcome {
  const rows = parseCsvRows(buffer.toString("utf8"));
  if (rows.length === 0) {
    return { status: "FAILED", totalRecords: 0, validRecords: 0, invalidRecords: 0, errors: [{ row: 0, field: "file", code: "EMPTY_FILE" }] };
  }

  const header = rows[0]!;
  const dataRows = rows.slice(1);
  const errors: ValidationError[] = [];

  dataRows.forEach((columns, idx) => {
    if (columns.length !== header.length) {
      if (errors.length < MAX_SAMPLED_ERRORS) {
        errors.push({ row: idx + 2, field: "row", code: "COLUMN_COUNT_MISMATCH" });
      }
    }
  });

  const invalidRecords = errors.length;
  const totalRecords = dataRows.length;
  return {
    status: invalidRecords > 0 ? "FAILED" : "PASSED",
    totalRecords,
    validRecords: totalRecords - invalidRecords,
    invalidRecords,
    errors,
  };
}

function validateJson(buffer: Buffer): ValidationOutcome {
  try {
    const parsed = JSON.parse(buffer.toString("utf8"));
    const records = Array.isArray(parsed) ? parsed : [parsed];
    return { status: "PASSED", totalRecords: records.length, validRecords: records.length, invalidRecords: 0, errors: [] };
  } catch {
    return {
      status: "FAILED",
      totalRecords: null,
      validRecords: null,
      invalidRecords: null,
      errors: [{ row: 0, field: "file", code: "MALFORMED_JSON" }],
    };
  }
}

function validateParquet(buffer: Buffer): ValidationOutcome {
  const magic = "PAR1";
  const hasHeaderMagic = buffer.subarray(0, 4).toString("ascii") === magic;
  const hasFooterMagic = buffer.subarray(-4).toString("ascii") === magic;
  if (!hasHeaderMagic || !hasFooterMagic) {
    return {
      status: "FAILED",
      totalRecords: null,
      validRecords: null,
      invalidRecords: null,
      errors: [{ row: 0, field: "file", code: "INVALID_PARQUET_MAGIC_BYTES" }],
    };
  }
  // Row-group level parsing requires a Parquet reader, deliberately not
  // added as a dependency for this phase — structural magic-byte check only.
  return { status: "PASSED", totalRecords: null, validRecords: null, invalidRecords: 0, errors: [] };
}

export async function persistValidationResult(
  exchangeId: string,
  outcome: ValidationOutcome,
  startedAt: Date,
): Promise<void> {
  await createExchangeValidation({
    validationId: generateValidationId(),
    exchangeId,
    validationType: "STRUCTURAL",
    status: outcome.status,
    totalRecords: outcome.totalRecords ?? 0,
    validRecords: outcome.validRecords ?? 0,
    invalidRecords: outcome.invalidRecords ?? 0,
    errorSummary: { errors: outcome.errors },
    startedAt,
    completedAt: new Date(),
  });
}
