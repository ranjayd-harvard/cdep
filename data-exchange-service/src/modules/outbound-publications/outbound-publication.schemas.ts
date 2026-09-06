import { z } from "zod";

// AGENTS.md (Phase 4 integration contract) section 24: the real Gold ->
// Publication Service -> Outbound Exchange handoff. Separate from
// ../publications/publication.schemas.ts, which backs the pre-existing
// fixture-content simulator (`POST /internal/v1/publications`) that cdep's
// own upload-triggered demo still uses -- this is additive, not a
// replacement.
export const createOutboundPublicationSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  dataProductId: z.string().min(1),
  productVersion: z.string().min(1),
  filename: z.string().min(1),
  format: z.enum(["PARQUET", "CSV", "JSON"]),
  sizeBytes: z.number().int().positive(),
  recordCount: z.number().int().nonnegative(),
  checksumAlgorithm: z.literal("SHA-256"),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePublicationId: z.string().min(1),
  expirationHours: z.number().int().positive().optional(),
});

export type CreateOutboundPublicationBody = z.infer<typeof createOutboundPublicationSchema>;

export const completeOutboundPublicationSchema = z.object({
  publicationId: z.string().min(1),
  goldSnapshotId: z.string().nullable().optional(),
  goldPipelineRunId: z.string().nullable().optional(),
});

export type CompleteOutboundPublicationBody = z.infer<typeof completeOutboundPublicationSchema>;

export const failOutboundPublicationSchema = z.object({
  reason: z.string().min(1),
});

export type FailOutboundPublicationBody = z.infer<typeof failOutboundPublicationSchema>;

export const exchangeIdParamSchema = z.object({
  exchangeId: z.string().min(1),
});
