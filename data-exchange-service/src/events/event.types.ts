export type ExchangeEventType =
  | "EXCHANGE_CREATED"
  | "UPLOAD_URL_ISSUED"
  | "FILE_RECEIVED"
  | "MANIFEST_CREATED"
  | "VALIDATION_STARTED"
  | "VALIDATION_FAILED"
  | "VALIDATION_COMPLETED"
  | "QUEUED_FOR_INGESTION"
  | "EXCHANGE_READY_FOR_INGESTION"
  | "DOWNLOAD_URL_ISSUED"
  | "FILE_DOWNLOADED"
  | "EXCHANGE_EXPIRED"
  | "EXCHANGE_PUBLISHED"
  | "CHECKSUM_MISMATCH"
  | "PUBLICATION_FAILED";

export type ActorType = "USER" | "SERVICE_ACCOUNT" | "SYSTEM" | "PLATFORM_ADMIN";

export interface AppendExchangeEventInput {
  exchangeId: string;
  eventType: ExchangeEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  eventData?: Record<string, unknown>;
}

export interface ExchangeEventRecord {
  eventId: string;
  exchangeId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string | null;
  actorId: string | null;
  eventData: Record<string, unknown> | null;
  occurredAt: string;
}
