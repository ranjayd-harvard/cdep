import { AppError, notFoundError } from "../../common/errors/app-error.js";
import { generateExchangeId, generateFileId } from "../../common/ids/id-generator.js";
import { sha256Hex } from "../../common/utils/checksum.js";
import { sanitizeFilename } from "../../common/utils/filename.js";
import { env } from "../../config/env.js";
import { pool } from "../../database/pool.js";
import { withTransaction } from "../../database/transaction.js";
import { appendExchangeEvent, listExchangeEvents } from "../../events/exchange-event.service.js";
import { assertDownloadEntitlement } from "../data-products/data-product.service.js";
import { getDataProduct } from "../data-products/data-product.repository.js";
import {
  createExchange,
  createExchangeFile,
  getExchangeByIdInternal,
  getExchangeFileByRole,
  updateExchangeStatus,
} from "../exchanges/exchange.repository.js";
import { assertValidTransition } from "../exchanges/exchange-transitions.js";
import { writeOutboundManifest } from "../manifests/manifest.service.js";
import type { OutboundManifest } from "../manifests/manifest.types.js";
import { objectStorage } from "../../storage/index.js";
import { buildOutboundDataKey } from "../../storage/storage-path-builder.js";
import type {
  CompleteOutboundPublicationBody,
  CreateOutboundPublicationBody,
} from "./outbound-publication.schemas.js";

async function assertTenantExists(organizationId: string, tenantId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM exchange.tenants WHERE tenant_id = $1 AND organization_id = $2`,
    [tenantId, organizationId],
  );
  if (rows.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Unknown organizationId/tenantId combination.");
  }
}

function contentTypeFor(format: string, filename: string): string {
  if (filename.endsWith(".gz")) return "application/gzip";
  if (format === "PARQUET") return "application/x-parquet";
  if (format === "JSON") return "application/json";
  return "text/csv";
}

export interface CreateOutboundPublicationResult {
  exchangeId: string;
  status: string;
  upload: { method: "PUT"; url: string; expiresInSeconds: number; contentType: string };
}

// Real Gold -> Publication Service -> Outbound Exchange handoff (AGENTS.md
// Phase 4 sections 21/22/24), as opposed to modules/publications/'s
// fixture-content simulator. This function only ever PREPARES the
// exchange and hands back a signed upload URL -- it never generates or
// touches file content itself, unlike the simulator.
export async function createOutboundPublication(
  body: CreateOutboundPublicationBody,
): Promise<CreateOutboundPublicationResult> {
  await assertTenantExists(body.organizationId, body.tenantId);

  const dataProduct = await getDataProduct(body.dataProductId);
  if (!dataProduct || dataProduct.status !== "ACTIVE") {
    throw new AppError("DATA_PRODUCT_NOT_FOUND", "The requested data product was not found.");
  }
  await assertDownloadEntitlement(body.tenantId, body.dataProductId);

  const filename = sanitizeFilename(body.filename);
  const contentType = contentTypeFor(body.format, filename);

  const exchangeId = generateExchangeId();
  const expirationHours = body.expirationHours ?? 168;
  const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);
  const objectKey = buildOutboundDataKey(body.organizationId, body.tenantId, exchangeId, filename);

  const uploadUrl = await withTransaction(async (client) => {
    await createExchange(
      {
        exchangeId,
        organizationId: body.organizationId,
        tenantId: body.tenantId,
        direction: "OUTBOUND",
        dataProductId: body.dataProductId,
        status: "PREPARING",
        schemaVersion: body.productVersion,
        sourceChannel: "GOLD_PUBLICATION",
        expiresAt,
      },
      client,
    );

    await appendExchangeEvent(
      {
        exchangeId,
        eventType: "EXCHANGE_CREATED",
        toStatus: "PREPARING",
        actorType: "SERVICE_ACCOUNT",
        eventData: {
          dataProductId: body.dataProductId,
          productVersion: body.productVersion,
          filename,
          recordCount: body.recordCount,
          sourcePublicationId: body.sourcePublicationId,
        },
      },
      client,
    );

    // Declared (not yet verified) size/checksum, so `complete` has
    // something to compare the actually-uploaded object against (AGENTS.md
    // section 45: never assume an object-store ETag equals this checksum --
    // `complete` below recomputes SHA-256 from the real bytes).
    await createExchangeFile(
      {
        exchangeFileId: generateFileId(),
        exchangeId,
        fileRole: "DATA",
        originalFilename: filename,
        bucketName: env.OUTBOUND_BUCKET,
        objectKey,
        contentType,
        fileFormat: body.format,
        sizeBytes: body.sizeBytes,
        checksumAlgorithm: body.checksumAlgorithm,
        checksum: body.checksum,
      },
      client,
    );

    const signed = await objectStorage.createUploadUrl({
      bucket: env.OUTBOUND_BUCKET,
      key: objectKey,
      contentType,
      expiresInSeconds: env.SIGNED_UPLOAD_URL_TTL_SECONDS,
    });

    await appendExchangeEvent(
      { exchangeId, eventType: "UPLOAD_URL_ISSUED", actorType: "SYSTEM", eventData: { expiresInSeconds: signed.expiresInSeconds } },
      client,
    );

    return signed;
  });

  return {
    exchangeId,
    status: "PREPARING",
    upload: { method: "PUT", url: uploadUrl.url, expiresInSeconds: uploadUrl.expiresInSeconds, contentType },
  };
}

export interface CompleteOutboundPublicationResult {
  exchangeId: string;
  status: string;
}

// Idempotent by construction, same discipline as uploads/upload.service.ts
// completeUpload: once an exchange has left PREPARING, calling this again
// just reports current state.
export async function completeOutboundPublication(
  exchangeId: string,
  body: CompleteOutboundPublicationBody,
): Promise<CompleteOutboundPublicationResult> {
  const exchange = await getExchangeByIdInternal(exchangeId);
  if (!exchange) throw notFoundError();
  if (exchange.direction !== "OUTBOUND") {
    throw new AppError("INVALID_STATE_TRANSITION", "Only OUTBOUND exchanges can be completed via this endpoint.");
  }
  if (exchange.status !== "PREPARING") {
    return { exchangeId, status: exchange.status };
  }

  const dataFile = await getExchangeFileByRole(exchangeId, "DATA");
  if (!dataFile) throw new AppError("CONFLICT", "Exchange is missing its expected data file record.");

  const head = await objectStorage.headObject(dataFile.bucket_name, dataFile.object_key);
  if (!head.exists) {
    throw new AppError("OBJECT_NOT_FOUND", "The published artifact was not found in storage. Has the upload finished?");
  }

  const object = await objectStorage.getObject(dataFile.bucket_name, dataFile.object_key);
  const actualChecksum = sha256Hex(object.body);
  const actualSizeBytes = head.contentLength ?? object.contentLength;

  if (dataFile.checksum && actualChecksum !== dataFile.checksum) {
    await withTransaction(async (client) => {
      assertValidTransition("OUTBOUND", "PREPARING", "FAILED");
      await updateExchangeStatus(exchangeId, exchange.organization_id, exchange.tenant_id, "FAILED", {}, client);
      await appendExchangeEvent(
        {
          exchangeId,
          eventType: "CHECKSUM_MISMATCH",
          fromStatus: "PREPARING",
          toStatus: "FAILED",
          actorType: "SYSTEM",
          eventData: { expectedChecksum: dataFile.checksum, actualChecksum },
        },
        client,
      );
    });
    throw new AppError(
      "CHECKSUM_MISMATCH",
      "Uploaded artifact checksum does not match the checksum declared at publication time.",
    );
  }

  await createExchangeFile({
    exchangeFileId: generateFileId(),
    exchangeId,
    fileRole: "DATA",
    originalFilename: dataFile.original_filename,
    bucketName: dataFile.bucket_name,
    objectKey: dataFile.object_key,
    contentType: dataFile.content_type,
    fileFormat: dataFile.file_format,
    sizeBytes: actualSizeBytes,
    checksumAlgorithm: "SHA-256",
    checksum: actualChecksum,
  });

  const createdEvent = (await listExchangeEvents(exchangeId)).find((e) => e.eventType === "EXCHANGE_CREATED");
  const createdData = (createdEvent?.eventData ?? {}) as {
    productVersion?: string;
    recordCount?: number;
    sourcePublicationId?: string;
  };

  const completedAt = new Date();
  await withTransaction(async (client) => {
    assertValidTransition("OUTBOUND", "PREPARING", "READY");
    await updateExchangeStatus(
      exchangeId,
      exchange.organization_id,
      exchange.tenant_id,
      "READY",
      { completedAt, recordCount: createdData.recordCount ?? null },
      client,
    );
    await appendExchangeEvent(
      {
        exchangeId,
        eventType: "EXCHANGE_PUBLISHED",
        fromStatus: "PREPARING",
        toStatus: "READY",
        actorType: "SERVICE_ACCOUNT",
        eventData: { publicationId: body.publicationId },
      },
      client,
    );
  });

  const manifest: OutboundManifest = {
    manifestVersion: "1.0",
    exchange: { exchangeId, direction: "OUTBOUND", status: "READY" },
    ownership: { organizationId: exchange.organization_id, tenantId: exchange.tenant_id },
    dataProduct: { dataProductId: exchange.data_product_id, schemaVersion: createdData.productVersion ?? exchange.schema_version },
    file: {
      publishedFilename: dataFile.original_filename ?? "unknown",
      contentType: dataFile.content_type ?? "application/octet-stream",
      format: dataFile.file_format ?? "UNKNOWN",
      sizeBytes: actualSizeBytes,
      recordCount: createdData.recordCount,
      checksumAlgorithm: "SHA-256",
      checksum: actualChecksum,
    },
    publication: {
      publicationId: body.publicationId,
      goldSnapshotId: body.goldSnapshotId ?? null,
      goldPipelineRunId: body.goldPipelineRunId ?? null,
    },
    timestamps: { publishedAt: completedAt.toISOString(), expiresAt: exchange.expires_at?.toISOString() ?? null },
  };
  const manifestKey = await writeOutboundManifest(
    objectStorage,
    dataFile.bucket_name,
    exchange.organization_id,
    exchange.tenant_id,
    exchangeId,
    manifest,
  );
  await createExchangeFile({
    exchangeFileId: generateFileId(),
    exchangeId,
    fileRole: "MANIFEST",
    storedFilename: "manifest.json",
    bucketName: dataFile.bucket_name,
    objectKey: manifestKey,
    contentType: "application/json",
  });
  await appendExchangeEvent({ exchangeId, eventType: "MANIFEST_CREATED", actorType: "SYSTEM" });

  return { exchangeId, status: "READY" };
}

export async function failOutboundPublication(exchangeId: string, reason: string): Promise<void> {
  const exchange = await getExchangeByIdInternal(exchangeId);
  if (!exchange) throw notFoundError();
  if (exchange.status === "FAILED") return; // idempotent

  await withTransaction(async (client) => {
    assertValidTransition("OUTBOUND", exchange.status, "FAILED");
    await updateExchangeStatus(exchangeId, exchange.organization_id, exchange.tenant_id, "FAILED", {}, client);
    await appendExchangeEvent(
      { exchangeId, eventType: "PUBLICATION_FAILED", toStatus: "FAILED", actorType: "SERVICE_ACCOUNT", eventData: { reason } },
      client,
    );
  });
}
