import { AppError, notFoundError } from "../../common/errors/app-error.js";
import { getDataProduct } from "../data-products/data-product.repository.js";
import { getExchangeValidation } from "../validations/validation.repository.js";
import { listExchangeEvents } from "../../events/exchange-event.service.js";
import {
  getExchangeById,
  getExchangeByIdInternal,
  getExchangeFileByRole,
  listExchanges as listExchangesRepo,
  listExchangesInternal as listExchangesInternalRepo,
} from "./exchange.repository.js";
import type { ListExchangesInternalQuery, ListExchangesQuery } from "./exchange.schemas.js";
import { objectStorage } from "../../storage/index.js";

// Customer-facing DTO mapping — deliberately excludes bucket_name/object_key
// and any other internal storage coordinates (AGENTS.md section 26/34).

export async function listExchanges(
  organizationId: string,
  tenantId: string,
  query: Omit<ListExchangesQuery, "limit"> & { limit?: number },
) {
  const { items, nextCursor } = await listExchangesRepo(organizationId, tenantId, {
    direction: query.direction,
    status: query.status,
    dataProductId: query.dataProductId,
    from: query.from,
    to: query.to,
    limit: query.limit ?? 20,
    cursor: query.cursor,
  });

  return {
    items: items.map((row) => ({
      exchangeId: row.exchange_id,
      direction: row.direction,
      status: row.status,
      dataProductId: row.data_product_id,
      schemaVersion: row.schema_version,
      recordCount: row.record_count ? Number(row.record_count) : null,
      errorCount: row.error_count ? Number(row.error_count) : null,
      startedAt: row.started_at?.toISOString() ?? null,
      receivedAt: row.received_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    })),
    nextCursor,
  };
}

// Internal-only, cross-tenant surface for the superadmin portal's Lakehouse
// Ingestion page (/admin/lakehouse) -- protected by requireInternalApiKey.
// Unlike listExchanges()'s customer-facing DTO above, this deliberately
// INCLUDES organizationId/tenantId: the caller has no tenant context of its
// own to already know it (that's the whole point of this endpoint).
export async function listExchangesInternal(
  query: Omit<ListExchangesInternalQuery, "limit"> & { limit?: number },
) {
  const rows = await listExchangesInternalRepo({
    direction: query.direction,
    limit: query.limit ?? 100,
  });

  return {
    items: rows.map((row) => ({
      exchangeId: row.exchange_id,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      direction: row.direction,
      status: row.status,
      dataProductId: row.data_product_id,
      schemaVersion: row.schema_version,
      filename: row.data_filename,
      recordCount: row.record_count ? Number(row.record_count) : null,
      errorCount: row.error_count ? Number(row.error_count) : null,
      startedAt: row.started_at?.toISOString() ?? null,
      receivedAt: row.received_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

export async function getExchangeDetail(exchangeId: string, organizationId: string, tenantId: string) {
  const exchange = await getExchangeById(exchangeId, organizationId, tenantId);
  if (!exchange) throw notFoundError();

  const [dataProduct, dataFile] = await Promise.all([
    getDataProduct(exchange.data_product_id),
    getExchangeFileByRole(exchange.exchange_id, "DATA"),
  ]);

  return {
    exchangeId: exchange.exchange_id,
    direction: exchange.direction,
    status: exchange.status,
    dataProduct: dataProduct
      ? { id: dataProduct.data_product_id, name: dataProduct.name }
      : { id: exchange.data_product_id, name: exchange.data_product_id },
    file: dataFile
      ? {
          filename: dataFile.original_filename,
          sizeBytes: dataFile.size_bytes ? Number(dataFile.size_bytes) : null,
          format: dataFile.file_format,
        }
      : null,
    schemaVersion: exchange.schema_version,
    recordCount: exchange.record_count ? Number(exchange.record_count) : null,
    errorCount: exchange.error_count ? Number(exchange.error_count) : null,
    startedAt: exchange.started_at?.toISOString() ?? null,
    receivedAt: exchange.received_at?.toISOString() ?? null,
    completedAt: exchange.completed_at?.toISOString() ?? null,
  };
}

export async function getExchangeEventsTimeline(exchangeId: string, organizationId: string, tenantId: string) {
  const exchange = await getExchangeById(exchangeId, organizationId, tenantId);
  if (!exchange) throw notFoundError();

  const events = await listExchangeEvents(exchangeId);
  return events.map((e) => ({
    eventType: e.eventType,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    occurredAt: e.occurredAt,
  }));
}

// Internal-only surface (AGENTS.md section 34/PHASE-2 lakehouse
// integration) -- protected by requireInternalApiKey, NOT customer JWT
// auth. Returns the already-written InboundManifest object verbatim
// (written once during upload completion, see manifests/manifest.service.ts
// and uploads/upload.service.ts), plus the DATA file's own storage
// coordinates, which customer-facing responses deliberately never expose.
export async function getExchangeManifestInternal(exchangeId: string) {
  const exchange = await getExchangeByIdInternal(exchangeId);
  if (!exchange) throw notFoundError();

  const manifestFile = await getExchangeFileByRole(exchangeId, "MANIFEST");
  if (!manifestFile) {
    throw new AppError(
      "CONFLICT",
      "No manifest is available yet for this exchange (upload has not completed).",
    );
  }
  const dataFile = await getExchangeFileByRole(exchangeId, "DATA");
  if (!dataFile) {
    throw new AppError("CONFLICT", "No data file is associated with this exchange.");
  }

  const manifestObject = await objectStorage.getObject(manifestFile.bucket_name, manifestFile.object_key);
  const manifest = JSON.parse(manifestObject.body.toString("utf8"));

  // manifest.json is written once (at RECEIVED, before validation runs)
  // and is never rewritten afterward (manifests/manifest.service.ts) --
  // its embedded exchange.status is a frozen snapshot, not live state.
  // Overwrite just that field with the exchange's *current* status so a
  // caller checking ingestion-readiness (e.g. VALIDATED) doesn't see a
  // stale RECEIVED forever. The persisted object on disk is untouched.
  manifest.exchange.status = exchange.status;

  return {
    manifest,
    storage: {
      bucketName: dataFile.bucket_name,
      objectKey: dataFile.object_key,
    },
  };
}

export async function getExchangeValidationResult(exchangeId: string, organizationId: string, tenantId: string) {
  const exchange = await getExchangeById(exchangeId, organizationId, tenantId);
  if (!exchange) throw notFoundError();

  const validation = await getExchangeValidation(exchangeId);
  if (!validation) throw notFoundError("No validation result is available for this exchange.");

  const errors = Array.isArray(validation.error_summary)
    ? (validation.error_summary as unknown[])
    : ((validation.error_summary as { errors?: unknown[] } | null)?.errors ?? []);

  return {
    status: validation.status,
    totalRecords: validation.total_records ? Number(validation.total_records) : null,
    validRecords: validation.valid_records ? Number(validation.valid_records) : null,
    invalidRecords: validation.invalid_records ? Number(validation.invalid_records) : null,
    errors,
  };
}
