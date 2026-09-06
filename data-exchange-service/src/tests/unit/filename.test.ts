import { describe, expect, it } from "vitest";
import { resolveFileFormat, sanitizeFilename } from "../../common/utils/filename.js";
import { AppError } from "../../common/errors/app-error.js";

describe("sanitizeFilename", () => {
  it("accepts a plain filename", () => {
    expect(sanitizeFilename("events_20260904.csv")).toBe("events_20260904.csv");
  });

  it("rejects path traversal", () => {
    expect(() => sanitizeFilename("../../etc/passwd")).toThrow(AppError);
  });

  it("rejects embedded path separators", () => {
    expect(() => sanitizeFilename("dir/file.csv")).toThrow(AppError);
  });

  it("rejects empty filenames", () => {
    expect(() => sanitizeFilename("   ")).toThrow(AppError);
  });
});

describe("resolveFileFormat", () => {
  it("resolves CSV by extension", () => {
    expect(resolveFileFormat("data.csv", "text/csv")).toBe("CSV");
  });

  it("resolves JSON by content-type when extension is ambiguous", () => {
    expect(resolveFileFormat("data.unknownext", "application/json")).toBe("JSON");
  });

  it("rejects unsupported formats", () => {
    expect(() => resolveFileFormat("script.exe", "application/x-msdownload")).toThrow(AppError);
  });
});
