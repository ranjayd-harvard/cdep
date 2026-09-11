import type { EventEnvelope } from "../dto/event-envelope.dto.js";
import type { PublicationRunRecord } from "../../ports/publication-client.port.js";
import type { OperationalStatus } from "../../config/constants.js";

function mapPublicationStatus(status: string): OperationalStatus {
  const upper = status.toUpperCase();
  if (upper === "READY" || upper === "SUCCEEDED" || upper === "COMPLETED") return "SUCCEEDED";
  if (upper === "FAILED") return "FAILED";
  if (upper === "SKIPPED_DUPLICATE" || upper === "CANCELLED") return "CANCELLED";
  if (upper === "RUNNING" || upper === "PROCESSING") return "RUNNING";
  if (upper === "PENDING") return "PENDING";
  return "UNKNOWN";
}

export function normalizePublicationRun(row: PublicationRunRecord): EventEnvelope {
  const status = mapPublicationStatus(row.status);
  const occurredAt = row.completedAt ?? row.startedAt ?? new Date();

  return {
    eventId: `publication:${row.publicationId}:${row.status}`,
    eventType: `PUBLICATION_${row.status}`,
    occurredAt: occurredAt.toISOString(),
    source: { service: "data-publication-service", entityType: "publication_run", entityId: row.publicationId },
    context: {
      organizationId: row.organizationId,
      tenantId: row.tenantId,
      dataProductId: row.dataProductId,
      productVersion: row.productVersion,
    },
    correlation: {
      goldPipelineRunId: row.sourcePipelineRunId ?? undefined,
      publicationId: row.publicationId,
      outboundExchangeId: row.outboundExchangeId ?? undefined,
    },
    operation: { stage: "PUBLICATION", status, attempt: 1, errorCode: row.errorCode ?? undefined, errorMessage: row.errorMessage ?? undefined },
    metrics: {},
    metadata: {
      inputRecordCount: row.inputRecordCount,
      outputRecordCount: row.outputRecordCount,
    },
  };
}
