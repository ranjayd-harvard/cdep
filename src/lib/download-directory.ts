import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { getTenantScopedCollection, type TenantOwnedDocument } from "@/lib/tenant-scoped-collection";
import type { DownloadableFile } from "@/models";

interface DownloadDocument extends TenantOwnedDocument {
  _id: string;
  datasetId: string;
  filename: string;
  format: string;
  generatedAt: string;
  sizeBytes: number;
  expiresAt: string;
  /** Internal-only pointer into GridFS (`file-storage.ts`) — never exposed on the public `DownloadableFile` shape. */
  storageFileId: string;
  /** Internal-only traceability back to the Exchange that produced this file — not part of the public shape. */
  sourceExchangeId: string | null;
}

function toDownload(doc: DownloadDocument): DownloadableFile {
  const { _id, tenantId: _tenantId, storageFileId: _storageFileId, sourceExchangeId: _sourceExchangeId, ...rest } =
    doc;
  return { id: _id, ...rest };
}

const DEFAULT_DOWNLOAD_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function listDownloads(tenantId: string): Promise<DownloadableFile[]> {
  const db = await getDb();
  const downloads = getTenantScopedCollection<DownloadDocument>(db, "downloads", tenantId);
  const docs = await downloads.find().sort({ generatedAt: -1 }).toArray();
  return docs.map(toDownload);
}

export async function getDownloadById(tenantId: string, fileId: string): Promise<DownloadableFile | null> {
  const db = await getDb();
  const downloads = getTenantScopedCollection<DownloadDocument>(db, "downloads", tenantId);
  const doc = await downloads.findOne({ _id: fileId });
  return doc ? toDownload(doc) : null;
}

/**
 * Resolves a download record to its GridFS storage id — the one place a
 * caller (the `/api/downloads/[fileId]/file` route) is allowed to learn
 * a storage id, and only after this tenant-scoped lookup confirms the
 * file actually belongs to the requesting tenant.
 */
export async function getDownloadStorageFileId(tenantId: string, fileId: string): Promise<string | null> {
  const db = await getDb();
  const downloads = getTenantScopedCollection<DownloadDocument>(db, "downloads", tenantId);
  const doc = await downloads.findOne({ _id: fileId });
  return doc?.storageFileId ?? null;
}

export interface CreateDownloadInput {
  datasetId: string;
  filename: string;
  format: string;
  sizeBytes: number;
  storageFileId: string;
  sourceExchangeId?: string | null;
  ttlMs?: number;
}

export async function createDownload(tenantId: string, input: CreateDownloadInput): Promise<DownloadableFile> {
  const db = await getDb();
  const downloads = getTenantScopedCollection<DownloadDocument>(db, "downloads", tenantId);
  const now = new Date();
  const doc: DownloadDocument = {
    _id: `dl-${randomBytes(4).toString("hex")}`,
    tenantId,
    datasetId: input.datasetId,
    filename: input.filename,
    format: input.format,
    generatedAt: now.toISOString(),
    sizeBytes: input.sizeBytes,
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_DOWNLOAD_TTL_MS)).toISOString(),
    storageFileId: input.storageFileId,
    sourceExchangeId: input.sourceExchangeId ?? null,
  };
  await downloads.insertOne(doc);
  return toDownload(doc);
}
