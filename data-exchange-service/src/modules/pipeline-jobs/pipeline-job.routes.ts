import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../auth/internal-auth.middleware.js";
import { parseOrThrow } from "../../common/utils/validate.js";
import {
  createPipelineJobSchema,
  listPipelineJobsQuerySchema,
  pipelineJobIdParamSchema,
} from "./pipeline-job.schemas.js";
import { enqueuePipelineJob, listPipelineJobs, runPipelineJobNow } from "./pipeline-job.service.js";

// Internal-only enqueue surface for the real Bronze->Silver->Gold->Publish
// pipeline -- protected by requireInternalApiKey, not customer JWT auth.
// Called from cdep's exchange-api-upload-service.ts when
// DEMO_FIXTURE_PUBLISH_ENABLED=false, instead of the fixture simulator in
// ../publications/. Scheduling/triggering the enqueued job is owned
// entirely by this service's own pipeline worker (see
// ../../pipeline-worker/) -- deliberately decoupled from the upload
// request that created it.
export async function pipelineJobRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/v1/pipeline-jobs",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Enqueue a Bronze->Silver->Gold->Publish pipeline run for a completed upload.",
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(createPipelineJobSchema, request.body);
      const result = await enqueuePipelineJob(body);
      reply.code(201).send(result);
    },
  );

  // Internal-only, cross-tenant surface for the superadmin portal's
  // "Pipeline Queue" admin page -- protected by requireInternalApiKey, not
  // customer JWT auth, same as /internal/v1/exchanges above it mirrors.
  app.get(
    "/internal/v1/pipeline-jobs",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "List pipeline jobs across all tenants (superadmin portal only).",
        querystring: {
          type: "object",
          properties: {
            status: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const query = parseOrThrow(listPipelineJobsQuerySchema, request.query);
      const items = await listPipelineJobs(query.status, query.limit);
      reply.code(200).send({ items });
    },
  );

  // Admin "Run" (a PENDING job, immediately instead of waiting for the next
  // poll tick) / "Re-enqueue" (a FAILED or SUCCEEDED job) action -- see
  // pipeline-worker.service.ts's runPipelineJobById for why both collapse
  // to the same operation.
  app.post(
    "/internal/v1/pipeline-jobs/:jobId/run",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Run or re-enqueue one pipeline job immediately (superadmin portal only).",
        params: { type: "object", properties: { jobId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { jobId } = parseOrThrow(pipelineJobIdParamSchema, request.params);
      const result = await runPipelineJobNow(jobId);
      reply.code(200).send(result);
    },
  );
}
