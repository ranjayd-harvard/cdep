import { z } from "zod";
import { IDENTIFIER_TYPES, OPERATIONAL_STAGES, OPERATIONAL_STATUSES } from "../../config/constants.js";

// The platform-neutral event envelope (spec section 7) — the single shape
// both POST /v1/events (push) and every poller/normalizer (pull) produce,
// so event-ingestion.service.ts has exactly one pipeline regardless of
// entry point. Deliberately excludes customer data rows, credentials,
// tokens, signed URLs, raw API payloads, and internal storage paths — that
// exclusion is enforced by convention at every normalizer/producer, not by
// this schema (the schema only constrains shape, not content).
export const eventEnvelopeSchema = z.object({
  eventId: z.string().min(1).max(128),
  eventType: z.string().min(1).max(64),
  occurredAt: z.string().datetime(),

  source: z.object({
    service: z.string().min(1),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
  }),

  context: z.object({
    organizationId: z.string().min(1).max(64),
    tenantId: z.string().min(1).max(64),
    dataProductId: z.string().min(1).max(128),
    productVersion: z.string().min(1).max(32),
    subscriptionId: z.string().optional(),
    scheduledRunId: z.string().optional(),
  }),

  correlation: z
    .object({
      correlationId: z.string().optional(),
      traceId: z.string().optional(),
      inboundExchangeId: z.string().optional(),
      outboundExchangeId: z.string().optional(),
      ingestionId: z.string().optional(),
      silverPipelineRunId: z.string().optional(),
      goldPipelineRunId: z.string().optional(),
      publicationId: z.string().optional(),
      deliveryRequestId: z.string().optional(),
      apiRequestId: z.string().optional(),
    })
    .default({}),

  operation: z.object({
    stage: z.enum(OPERATIONAL_STAGES).nullable().optional(),
    status: z.enum(OPERATIONAL_STATUSES).nullable().optional(),
    attempt: z.number().int().positive().default(1),
    errorCategory: z.string().optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  }),

  metrics: z
    .object({
      durationMs: z.number().nonnegative().optional(),
    })
    .default({}),

  // Never customer row-level data — an allowlist-shaped bag for
  // operationally-safe extras (record counts, quality summary, etc.).
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

const IDENTIFIER_FIELD_TO_TYPE = {
  inboundExchangeId: "INBOUND_EXCHANGE_ID",
  outboundExchangeId: "OUTBOUND_EXCHANGE_ID",
  ingestionId: "INGESTION_ID",
  silverPipelineRunId: "SILVER_PIPELINE_RUN_ID",
  goldPipelineRunId: "GOLD_PIPELINE_RUN_ID",
  publicationId: "PUBLICATION_ID",
  deliveryRequestId: "DELIVERY_REQUEST_ID",
  apiRequestId: "API_REQUEST_ID",
} as const;

export function extractIdentifiers(envelope: EventEnvelope): Partial<Record<(typeof IDENTIFIER_TYPES)[number], string>> {
  const identifiers: Partial<Record<(typeof IDENTIFIER_TYPES)[number], string>> = {};
  for (const [field, idType] of Object.entries(IDENTIFIER_FIELD_TO_TYPE)) {
    const value = (envelope.correlation as Record<string, string | undefined>)[field];
    if (value) identifiers[idType] = value;
  }
  if (envelope.context.scheduledRunId) identifiers.SCHEDULED_RUN_ID = envelope.context.scheduledRunId;
  if (envelope.context.subscriptionId) identifiers.SUBSCRIPTION_ID = envelope.context.subscriptionId;
  return identifiers;
}
