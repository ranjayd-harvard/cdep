export const ACCEPTED_UPLOAD_EXTENSIONS = [".csv", ".json", ".parquet"] as const;

export function isAcceptedUploadFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_UPLOAD_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export const MAX_UPLOAD_SIZE_BYTES = 250 * 1024 * 1024;
