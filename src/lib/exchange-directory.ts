import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { getTenantScopedCollection, type TenantOwnedDocument } from "@/lib/tenant-scoped-collection";
import type { Exchange, ExchangeDirection, ExchangeStatus, ExchangeValidationError } from "@/models";

interface ExchangeDocument extends TenantOwnedDocument {
  _id: string;
  datasetId: string;
  direction: ExchangeDirection;
  status: ExchangeStatus;
  filename: string;
  fileSize: number;
  recordCount: number;
  receivedAt: string;
  completedAt: string | null;
  schemaVersion: string;
  correlationId: string;
  errorCount: number;
  validationErrors: ExchangeValidationError[];
  /** Internal-only pointer into GridFS (`file-storage.ts`) — never exposed on the public `Exchange` shape. */
  storageFileId: string | null;
}

/**
 * `exchanges` is the audit trail this feature was built for: every
 * inbound upload and every outbound file made available for download is
 * one row here, created once already in its final state — there is no
 * queue/worker in this stack, so a real exchange never transitions after
 * creation the way the mock's staged progress simulation does.
 */
function toExchange(doc: ExchangeDocument): Exchange {
  const { _id, storageFileId: _storageFileId, ...rest } = doc;
  return { id: _id, ...rest };
}

export async function listExchanges(tenantId: string): Promise<Exchange[]> {
  const db = await getDb();
  const exchanges = getTenantScopedCollection<ExchangeDocument>(db, "exchanges", tenantId);
  const docs = await exchanges.find().sort({ receivedAt: -1 }).toArray();
  return docs.map(toExchange);
}

export async function getExchangeById(tenantId: string, exchangeId: string): Promise<Exchange | null> {
  const db = await getDb();
  const exchanges = getTenantScopedCollection<ExchangeDocument>(db, "exchanges", tenantId);
  const doc = await exchanges.findOne({ _id: exchangeId });
  return doc ? toExchange(doc) : null;
}

export interface CreateExchangeInput {
  datasetId: string;
  direction: ExchangeDirection;
  status: ExchangeStatus;
  filename: string;
  fileSize: number;
  recordCount: number;
  schemaVersion: string;
  storageFileId: string | null;
  completedAt: string | null;
  errorCount?: number;
  validationErrors?: ExchangeValidationError[];
}

export async function createExchange(tenantId: string, input: CreateExchangeInput): Promise<Exchange> {
  const db = await getDb();
  const exchanges = getTenantScopedCollection<ExchangeDocument>(db, "exchanges", tenantId);
  const doc: ExchangeDocument = {
    _id: `exch-${randomBytes(4).toString("hex")}`,
    tenantId,
    datasetId: input.datasetId,
    direction: input.direction,
    status: input.status,
    filename: input.filename,
    fileSize: input.fileSize,
    recordCount: input.recordCount,
    receivedAt: new Date().toISOString(),
    completedAt: input.completedAt,
    schemaVersion: input.schemaVersion,
    correlationId: `corr-${randomBytes(4).toString("hex")}`,
    errorCount: input.errorCount ?? 0,
    validationErrors: input.validationErrors ?? [],
    storageFileId: input.storageFileId,
  };
  await exchanges.insertOne(doc);
  return toExchange(doc);
}
