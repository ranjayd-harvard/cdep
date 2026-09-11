import type { ExchangeDirection, ExchangeStatus } from "../../config/constants.js";

export interface ExchangeRow {
  exchange_id: string;
  organization_id: string;
  tenant_id: string;
  direction: ExchangeDirection;
  data_product_id: string;
  initiated_by_user_id: string | null;
  status: ExchangeStatus;
  schema_version: string | null;
  source_channel: string | null;
  record_count: string | null;
  error_count: string | null;
  started_at: Date | null;
  received_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
  correlation_id: string | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
  legal_hold: boolean;
}

export interface CreateExchangeInput {
  exchangeId: string;
  organizationId: string;
  tenantId: string;
  direction: ExchangeDirection;
  dataProductId: string;
  initiatedByUserId?: string | null;
  status: ExchangeStatus;
  schemaVersion?: string | null;
  sourceChannel?: string | null;
  expiresAt?: Date | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}

export interface ExchangeFileRow {
  exchange_file_id: string;
  exchange_id: string;
  file_role: string;
  original_filename: string | null;
  stored_filename: string | null;
  bucket_name: string;
  object_key: string;
  content_type: string | null;
  file_format: string | null;
  size_bytes: string | null;
  checksum_algorithm: string | null;
  checksum: string | null;
  created_at: Date;
}

export interface ListExchangesFilter {
  direction?: ExchangeDirection;
  status?: ExchangeStatus;
  dataProductId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

// Cross-tenant (superadmin portal) equivalent of ListExchangesFilter above --
// no organization/tenant scoping, deliberately smaller (no cursor pagination;
// this only ever backs a "recent exchanges" admin view, not a full browser).
export interface ListExchangesInternalFilter {
  direction?: ExchangeDirection;
  limit: number;
}

// listExchangesInternal's row shape: an ExchangeRow plus the original
// filename of its DATA file (exchange.exchange_files, file_role='DATA'),
// via a LEFT JOIN LATERAL -- null if no DATA file has been created yet
// (e.g. a PENDING_UPLOAD exchange, though in practice createExchangeFile
// runs in the same transaction as the exchange row itself, see
// uploads/upload.service.ts). Only bucket_name/object_key stay
// off-limits to this admin surface -- see the DDL comment in
// migrations/005_exchange_files.sql.
export interface ExchangeRowWithFilename extends ExchangeRow {
  data_filename: string | null;
}
