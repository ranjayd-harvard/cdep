import type { EventEnvelope } from "../dto/event-envelope.dto.js";
import type { ExchangeRecord } from "../../ports/exchange-client.port.js";
import type { OperationalStage, OperationalStatus } from "../../config/constants.js";

// Maps data-exchange-service's real EXCHANGE_STATUSES (confirmed against
// data-exchange-service/src/config/constants.ts and migrations/004) onto
// the fixed normalized vocabulary. Adapters are the only place this
// service-specific knowledge lives — nothing downstream ever sees a raw
// exchange status string.
const INBOUND_STATUS_MAP: Record<string, { stage: OperationalStage; status: OperationalStatus }> = {
  PENDING_UPLOAD: { stage: "EXCHANGE_RECEIVED", status: "PENDING" },
  UPLOADING: { stage: "EXCHANGE_RECEIVED", status: "RUNNING" },
  RECEIVED: { stage: "EXCHANGE_RECEIVED", status: "SUCCEEDED" },
  VALIDATING: { stage: "EXCHANGE_VALIDATION", status: "RUNNING" },
  VALIDATION_FAILED: { stage: "EXCHANGE_VALIDATION", status: "FAILED" },
  VALIDATED: { stage: "EXCHANGE_VALIDATION", status: "SUCCEEDED" },
  QUEUED_FOR_INGESTION: { stage: "EXCHANGE_VALIDATION", status: "SUCCEEDED" },
  PROCESSING: { stage: "EXCHANGE_VALIDATION", status: "SUCCEEDED" },
  COMPLETED: { stage: "EXCHANGE_VALIDATION", status: "SUCCEEDED" },
  FAILED: { stage: "EXCHANGE_VALIDATION", status: "FAILED" },
  CANCELLED: { stage: "EXCHANGE_VALIDATION", status: "CANCELLED" },
  EXPIRED: { stage: "EXCHANGE_VALIDATION", status: "FAILED" },
};

const OUTBOUND_STATUS_MAP: Record<string, { stage: OperationalStage; status: OperationalStatus }> = {
  PREPARING: { stage: "OUTBOUND_EXCHANGE", status: "RUNNING" },
  READY: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
  DOWNLOADED: { stage: "FILE_DELIVERY", status: "SUCCEEDED" },
  FAILED: { stage: "OUTBOUND_EXCHANGE", status: "FAILED" },
  CANCELLED: { stage: "OUTBOUND_EXCHANGE", status: "CANCELLED" },
  EXPIRED: { stage: "FILE_DELIVERY", status: "FAILED" },
};

export function normalizeExchangeRecord(record: ExchangeRecord, productVersion: string): EventEnvelope {
  const map = record.direction === "INBOUND" ? INBOUND_STATUS_MAP : OUTBOUND_STATUS_MAP;
  const mapped = map[record.status] ?? { stage: (record.direction === "INBOUND" ? "EXCHANGE_RECEIVED" : "OUTBOUND_EXCHANGE") as OperationalStage, status: "UNKNOWN" as OperationalStatus };

  const occurredAt = record.completedAt ?? record.receivedAt ?? record.startedAt ?? record.createdAt;

  return {
    eventId: `exchange:${record.exchangeId}:${record.status}`,
    eventType: `EXCHANGE_${record.direction}_${record.status}`,
    occurredAt: occurredAt.toISOString(),
    source: { service: "data-exchange-service", entityType: "exchange", entityId: record.exchangeId },
    context: {
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      dataProductId: record.dataProductId,
      productVersion,
    },
    correlation:
      record.direction === "INBOUND" ? { inboundExchangeId: record.exchangeId } : { outboundExchangeId: record.exchangeId },
    operation: { stage: mapped.stage, status: mapped.status, attempt: 1 },
    metrics: {},
    metadata: {
      recordCount: record.recordCount,
      errorCount: record.errorCount,
    },
  };
}
