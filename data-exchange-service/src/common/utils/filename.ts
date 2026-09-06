import { AppError } from "../errors/app-error.js";
import { EXTENSION_TO_FORMAT, CONTENT_TYPE_TO_FORMAT, type SupportedFileFormat } from "../../config/constants.js";

const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

// Rejects path traversal, control characters, and anything that isn't a
// plain single-segment filename. Clients never dictate storage paths (see
// AGENTS.md section 8/60) but the *filename component* is still customer
// input and must be validated before it is echoed into an object key.
export function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    !SAFE_FILENAME_RE.test(trimmed)
  ) {
    throw new AppError("INVALID_FILE", "Filename contains unsupported characters or path segments.");
  }
  return trimmed;
}

export function resolveFileFormat(filename: string, contentType: string): SupportedFileFormat {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const byExtension = EXTENSION_TO_FORMAT[ext];
  if (byExtension) return byExtension;

  const byContentType = CONTENT_TYPE_TO_FORMAT[contentType.toLowerCase()];
  if (byContentType) return byContentType;

  throw new AppError(
    "INVALID_FILE",
    `Unsupported file type. Allowed formats: CSV, JSON, PARQUET (got extension ".${ext}", content-type "${contentType}").`,
  );
}
