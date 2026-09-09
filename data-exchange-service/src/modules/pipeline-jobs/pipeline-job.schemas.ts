import { z } from "zod";

// Enqueue surface for the real Bronze -> Silver -> Gold -> Publish pipeline.
// Separate from ../publications/publication.schemas.ts (the fixture-content
// simulator) and ../outbound-publications/outbound-publication.schemas.ts
// (the manual-publish handoff from data-publication-service) -- this one
// backs the automated, queued path cdep's upload flow uses when
// DEMO_FIXTURE_PUBLISH_ENABLED=false.
export const createPipelineJobSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  dataProductId: z.string().min(1),
  exchangeId: z.string().min(1),
});

export type CreatePipelineJobBody = z.infer<typeof createPipelineJobSchema>;

const PIPELINE_JOB_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;

// Backs the admin "Pipeline Queue" list (GET /internal/v1/pipeline-jobs) --
// mirrors listExchangesInternalQuerySchema's shape (exchange.routes.ts):
// no cursor/date-range, just a status filter + capped limit for a
// dashboard-style view.
export const listPipelineJobsQuerySchema = z.object({
  status: z.enum(PIPELINE_JOB_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type ListPipelineJobsQuery = z.infer<typeof listPipelineJobsQuerySchema>;

export const pipelineJobIdParamSchema = z.object({
  jobId: z.string().min(1),
});
