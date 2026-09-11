import { AppError, notFoundError } from "../../common/errors/app-error.js";
import { generateExchangeId, generateFileId } from "../../common/ids/id-generator.js";
import { sha256Hex } from "../../common/utils/checksum.js";
import { resolveFileFormat, sanitizeFilename } from "../../common/utils/filename.js";
import type { SupportedFileFormat } from "../../config/constants.js";
import { env } from "../../config/env.js";
import type { RequestContext } from "../../auth/request-context.js";
import { withTransaction } from "../../database/transaction.js";
import { appendExchangeEvent } from "../../events/exchange-event.service.js";
import { ingestionNotifier } from "../../events/ingestion-notifier.js";
import { assertUploadEntitlement } from "../data-products/data-product.service.js";
import {
  createExchange,
  createExchangeFile,
  findExchangeByIdempotencyKey,
  getExchangeById,
  getExchangeFileByRole,
  updateExchangeStatus,
} from "../exchanges/exchange.repository.js";
import { assertValidTransition } from "../exchanges/exchange-transitions.js";
import { writeInboundManifest, writeInboundValidationSidecar } from "../manifests/manifest.service.js";
import type { InboundManifest } from "../manifests/manifest.types.js";
import { objectStorage } from "../../storage/index.js";
import { buildInboundDataKey } from "../../storage/storage-path-builder.js";
import { persistValidationResult, validateFileContent } from "../validations/validation.service.js";
import type { InitiateUploadBody } from "./upload.schemas.js";

export interface InitiateUploadResult {
  exchangeId: string;
  status: string;
  upload: { method: "PUT"; url: string; expiresInSeconds: number };
}

export async function initiateUpload(
  ctx: RequestContext,
  body: InitiateUploadBody,
  opts: { idempotencyKey?: string; correlationId: string },
): Promise<InitiateUploadResult> {
  if (body.sizeBytes > env.MAX_UPLOAD_SIZE_BYTES) {
    throw new AppError("FILE_TOO_LARGE", `File exceeds maximum allowed size of ${env.MAX_UPLOAD_SIZE_BYTES} bytes.`);
  }
  if (body.sizeBytes === 0) {
    throw new AppError("INVALID_FILE", "Zero-byte files are not allowed.");
  }

  const filename = sanitizeFilename(body.filename);
  const fileFormat = resolveFileFormat(filename, body.contentType);

  await assertUploadEntitlement(ctx.activeTenantId, body.dataProductId);

  if (opts.idempotencyKey) {
    const existing = await findExchangeByIdempotencyKey(ctx.organizationId, ctx.activeTenantId, opts.idempotencyKey);
    if (existing) {
      const dataFile = await getExchangeFileByRole(existing.exchange_id, "DATA");
      if (!dataFile) throw new AppError("CONFLICT", "Idempotent exchange is missing its data file record.");
      const uploadUrl = await objectStorage.createUploadUrl({
        bucket: dataFile.bucket_name,
        key: dataFile.object_key,
        contentType: dataFile.content_type ?? body.contentType,
        expiresInSeconds: env.SIGNED_UPLOAD_URL_TTL_SECONDS,
      });
      return {
        exchangeId: existing.exchange_id,
        status: existing.status,
        upload: { method: "PUT", url: uploadUrl.url, expiresInSeconds: uploadUrl.expiresInSeconds },
      };
    }
  }

  const exchangeId = generateExchangeId();
  const objectKey = buildInboundDataKey(ctx.organizationId, ctx.activeTenantId, exchangeId, filename);

  const uploadUrl = await withTransaction(async (client) => {
    const exchange = await createExchange(
      {
        exchangeId,
        organizationId: ctx.organizationId,
        tenantId: ctx.activeTenantId,
        direction: "INBOUND",
        dataProductId: body.dataProductId,
        initiatedByUserId: ctx.userId,
        status: "PENDING_UPLOAD",
        schemaVersion: body.schemaVersion ?? null,
        sourceChannel: "CUSTOMER_PORTAL",
        correlationId: opts.correlationId,
        idempotencyKey: opts.idempotencyKey ?? null,
      },
      client,
    );

    await createExchangeFile(
      {
        exchangeFileId: generateFileId(),
        exchangeId: exchange.exchange_id,
        fileRole: "DATA",
        originalFilename: filename,
        bucketName: env.INBOUND_BUCKET,
        objectKey,
        contentType: body.contentType,
        fileFormat,
        sizeBytes: body.sizeBytes,
      },
      client,
    );

    await appendExchangeEvent(
      {
        exchangeId: exchange.exchange_id,
        eventType: "EXCHANGE_CREATED",
        toStatus: "PENDING_UPLOAD",
        actorType: ctx.role === "SERVICE_ACCOUNT" ? "SERVICE_ACCOUNT" : "USER",
        actorId: ctx.userId,
        eventData: { dataProductId: body.dataProductId, filename },
      },
      client,
    );

    const signed = await objectStorage.createUploadUrl({
      bucket: env.INBOUND_BUCKET,
      key: objectKey,
      contentType: body.contentType,
      expiresInSeconds: env.SIGNED_UPLOAD_URL_TTL_SECONDS,
    });

    await appendExchangeEvent(
      {
        exchangeId: exchange.exchange_id,
        eventType: "UPLOAD_URL_ISSUED",
        actorType: "SYSTEM",
        eventData: { expiresInSeconds: signed.expiresInSeconds },
      },
      client,
    );

    return signed;
  });

  return {
    exchangeId,
    status: "PENDING_UPLOAD",
    upload: { method: "PUT", url: uploadUrl.url, expiresInSeconds: uploadUrl.expiresInSeconds },
  };
}

export interface CompleteUploadResult {
  exchangeId: string;
  status: string;
}

// Idempotent by construction: once an exchange has left PENDING_UPLOAD /
// UPLOADING, calling complete again just reports current state instead of
// redoing manifest/validation work (AGENTS.md section 14).
export async function completeUpload(
  ctx: RequestContext,
  exchangeId: string,
): Promise<CompleteUploadResult> {
  const exchange = await getExchangeById(exchangeId, ctx.organizationId, ctx.activeTenantId);
  if (!exchange) throw notFoundError();
  if (exchange.direction !== "INBOUND") {
    throw new AppError("INVALID_STATE_TRANSITION", "Only INBOUND exchanges can be completed via this endpoint.");
  }

  if (exchange.status !== "PENDING_UPLOAD" && exchange.status !== "UPLOADING") {
    return { exchangeId, status: exchange.status };
  }

  const dataFile = await getExchangeFileByRole(exchangeId, "DATA");
  if (!dataFile) throw new AppError("CONFLICT", "Exchange is missing its expected data file record.");

  const head = await objectStorage.headObject(dataFile.bucket_name, dataFile.object_key);
  if (!head.exists) {
    throw new AppError("OBJECT_NOT_FOUND", "The uploaded object was not found in storage. Has the upload finished?");
  }

  const object = await objectStorage.getObject(dataFile.bucket_name, dataFile.object_key);
  const checksum = sha256Hex(object.body);
  const actualSizeBytes = head.contentLength ?? object.contentLength;

  // Phase 11 (spec §10.34): the presigned PUT URL cannot itself enforce a
  // size limit, so the declared sizeBytes check at initiate-time (line ~39
  // above) is not sufficient on its own — a client can PUT arbitrarily more
  // bytes than it declared. This is the actual enforcement point, against
  // the real object once it exists in storage. An oversized object is
  // deleted immediately (never persisted as a completed exchange) and the
  // exchange fails rather than silently accepting it.
  if (actualSizeBytes > env.MAX_UPLOAD_SIZE_BYTES) {
    await objectStorage.deleteObject(dataFile.bucket_name, dataFile.object_key);
    await updateExchangeStatus(exchangeId, ctx.organizationId, ctx.activeTenantId, "FAILED");
    await appendExchangeEvent({
      exchangeId,
      eventType: "VALIDATION_FAILED",
      fromStatus: exchange.status,
      toStatus: "FAILED",
      actorType: "SYSTEM",
      eventData: { reason: "FILE_TOO_LARGE", actualSizeBytes, maxAllowedBytes: env.MAX_UPLOAD_SIZE_BYTES },
    });
    throw new AppError(
      "FILE_TOO_LARGE",
      `Uploaded object is ${actualSizeBytes} bytes, exceeding the maximum allowed size of ${env.MAX_UPLOAD_SIZE_BYTES} bytes.`,
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
    checksum,
  });

  const receivedAt = new Date();

  await withTransaction(async (client) => {
    assertValidTransition("INBOUND", exchange.status, "RECEIVED");
    await updateExchangeStatus(exchangeId, ctx.organizationId, ctx.activeTenantId, "RECEIVED", { receivedAt }, client);
    await appendExchangeEvent(
      {
        exchangeId,
        eventType: "FILE_RECEIVED",
        fromStatus: exchange.status,
        toStatus: "RECEIVED",
        actorType: "SYSTEM",
        eventData: { sizeBytes: actualSizeBytes, checksum },
      },
      client,
    );
  });

  const manifest: InboundManifest = {
    manifestVersion: "1.0",
    exchange: { exchangeId, direction: "INBOUND", status: "RECEIVED" },
    ownership: { organizationId: ctx.organizationId, tenantId: ctx.activeTenantId },
    submittedBy: { userId: exchange.initiated_by_user_id },
    dataProduct: { dataProductId: exchange.data_product_id, schemaVersion: exchange.schema_version },
    file: {
      originalFilename: dataFile.original_filename ?? "unknown",
      contentType: dataFile.content_type ?? "application/octet-stream",
      format: dataFile.file_format ?? "UNKNOWN",
      sizeBytes: actualSizeBytes,
      checksumAlgorithm: "SHA-256",
      checksum,
    },
    source: { channel: exchange.source_channel ?? "CUSTOMER_PORTAL" },
    timestamps: {
      uploadStartedAt: exchange.started_at?.toISOString() ?? null,
      receivedAt: receivedAt.toISOString(),
    },
  };

  const manifestKey = await writeInboundManifest(
    objectStorage,
    dataFile.bucket_name,
    ctx.organizationId,
    ctx.activeTenantId,
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

  const validationStartedAt = new Date();
  await appendExchangeEvent({
    exchangeId,
    eventType: "VALIDATION_STARTED",
    fromStatus: "RECEIVED",
    toStatus: "VALIDATING",
    actorType: "SYSTEM",
  });

  const format: SupportedFileFormat =
    (dataFile.file_format as SupportedFileFormat | null) ??
    resolveFileFormat(dataFile.original_filename ?? "file.csv", dataFile.content_type ?? "text/csv");
  const outcome = validateFileContent(object.body, format);
  await persistValidationResult(exchangeId, outcome, validationStartedAt);

  const validationSidecarKey = await writeInboundValidationSidecar(
    objectStorage,
    dataFile.bucket_name,
    ctx.organizationId,
    ctx.activeTenantId,
    exchangeId,
    { status: outcome.status, totalRecords: outcome.totalRecords, validRecords: outcome.validRecords, invalidRecords: outcome.invalidRecords, errors: outcome.errors },
  );
  await createExchangeFile({
    exchangeFileId: generateFileId(),
    exchangeId,
    fileRole: "VALIDATION",
    storedFilename: "validation.json",
    bucketName: dataFile.bucket_name,
    objectKey: validationSidecarKey,
    contentType: "application/json",
  });

  const finalStatus = outcome.status === "PASSED" ? "VALIDATED" : "VALIDATION_FAILED";

  await withTransaction(async (client) => {
    assertValidTransition("INBOUND", "VALIDATING", finalStatus);
    await updateExchangeStatus(
      exchangeId,
      ctx.organizationId,
      ctx.activeTenantId,
      finalStatus,
      { recordCount: outcome.totalRecords, errorCount: outcome.invalidRecords },
      client,
    );
    await appendExchangeEvent(
      {
        exchangeId,
        eventType: finalStatus === "VALIDATED" ? "VALIDATION_COMPLETED" : "VALIDATION_FAILED",
        fromStatus: "VALIDATING",
        toStatus: finalStatus,
        actorType: "SYSTEM",
        eventData: { totalRecords: outcome.totalRecords, invalidRecords: outcome.invalidRecords },
      },
      client,
    );
  });

  if (finalStatus === "VALIDATED") {
    await ingestionNotifier.notifyExchangeReady({
      exchangeId,
      organizationId: ctx.organizationId,
      tenantId: ctx.activeTenantId,
      dataProductId: exchange.data_product_id,
    });
  }

  return { exchangeId, status: finalStatus };
}
