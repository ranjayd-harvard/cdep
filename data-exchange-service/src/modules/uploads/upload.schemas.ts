import { z } from "zod";

export const initiateUploadSchema = z.object({
  dataProductId: z.string().min(1),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  // Zero is accepted at the schema layer on purpose: rejecting zero-byte
  // files is a *file-safety* rule (AGENTS.md section 40), so it is enforced
  // in upload.service.ts alongside the other file-safety checks and reported
  // as INVALID_FILE, consistent with "unsupported file type" — not as a
  // generic input-shape VALIDATION_ERROR.
  sizeBytes: z.number().int().nonnegative(),
  schemaVersion: z.string().min(1).optional(),
});

export type InitiateUploadBody = z.infer<typeof initiateUploadSchema>;

export const completeUploadParamsSchema = z.object({
  exchangeId: z.string().min(1),
});
