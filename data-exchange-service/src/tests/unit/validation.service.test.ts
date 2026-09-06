import { describe, expect, it } from "vitest";
import { validateFileContent } from "../../modules/validations/validation.service.js";

describe("validateFileContent", () => {
  it("passes a well-formed CSV", () => {
    const buf = Buffer.from("id,name\n1,alpha\n2,beta\n");
    const outcome = validateFileContent(buf, "CSV");
    expect(outcome.status).toBe("PASSED");
    expect(outcome.totalRecords).toBe(2);
    expect(outcome.invalidRecords).toBe(0);
  });

  it("flags CSV rows with mismatched column counts", () => {
    const buf = Buffer.from("id,name\n1,alpha\n2\n");
    const outcome = validateFileContent(buf, "CSV");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.invalidRecords).toBe(1);
    expect(outcome.errors[0]?.code).toBe("COLUMN_COUNT_MISMATCH");
  });

  // Regression coverage for a real Salesforce product export that a naive
  // `line.split(",")` misclassified almost entirely: quoted fields
  // containing commas and multi-paragraph embedded newlines corrupted
  // both the column count and the row count.
  it("does not misparse a quoted field containing commas", () => {
    const buf = Buffer.from('id,name,description\n1,"Widget","Small, sturdy, and cheap"\n');
    const outcome = validateFileContent(buf, "CSV");
    expect(outcome.status).toBe("PASSED");
    expect(outcome.totalRecords).toBe(1);
  });

  it("does not misparse a quoted field containing an embedded newline", () => {
    const buf = Buffer.from('id,name,description\n1,"Widget","Line one.\n\nLine two, with a comma."\n2,"Gadget","No newline here"\n');
    const outcome = validateFileContent(buf, "CSV");
    expect(outcome.status).toBe("PASSED");
    expect(outcome.totalRecords).toBe(2);
  });

  it("unescapes doubled quotes inside a quoted field without corrupting row parsing", () => {
    const buf = Buffer.from('id,name\n1,"40-50"" Weatherproof Enclosure"\n2,"Normal Row"\n');
    const outcome = validateFileContent(buf, "CSV");
    expect(outcome.status).toBe("PASSED");
    expect(outcome.totalRecords).toBe(2);
  });

  it("still flags a genuine column-count mismatch once quoting is accounted for", () => {
    const buf = Buffer.from('id,name,description\n1,"Widget","fine, quoted, field"\n2,"Gadget"\n');
    const outcome = validateFileContent(buf, "CSV");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.invalidRecords).toBe(1);
    expect(outcome.errors[0]?.row).toBe(3);
  });

  it("passes a well-formed JSON array", () => {
    const buf = Buffer.from(JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }]));
    const outcome = validateFileContent(buf, "JSON");
    expect(outcome.status).toBe("PASSED");
    expect(outcome.totalRecords).toBe(3);
  });

  it("fails malformed JSON", () => {
    const buf = Buffer.from("{not valid json");
    const outcome = validateFileContent(buf, "JSON");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.errors[0]?.code).toBe("MALFORMED_JSON");
  });

  it("fails zero-byte files regardless of declared format", () => {
    const outcome = validateFileContent(Buffer.alloc(0), "CSV");
    expect(outcome.status).toBe("FAILED");
    expect(outcome.errors[0]?.code).toBe("EMPTY_FILE");
  });

  it("checks parquet magic bytes", () => {
    const good = Buffer.concat([Buffer.from("PAR1"), Buffer.from("body"), Buffer.from("PAR1")]);
    expect(validateFileContent(good, "PARQUET").status).toBe("PASSED");

    const bad = Buffer.from("not-a-parquet-file");
    expect(validateFileContent(bad, "PARQUET").status).toBe("FAILED");
  });
});
