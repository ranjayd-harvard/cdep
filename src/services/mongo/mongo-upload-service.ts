import {
  ExchangeDirection,
  ExchangeStatus,
  NotificationType,
  UploadStatus,
  type Exchange,
  type UploadRequest,
  type UploadResult,
} from "@/models";
import type { UploadProgressHandler, UploadService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { ACCEPTED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES, isAcceptedUploadFile } from "@/lib/upload-validation";
import { storeFile } from "@/lib/file-storage";
import { createExchange } from "@/lib/exchange-directory";
import { createDownload } from "@/lib/download-directory";
import { createNotification } from "@/lib/notification-directory";
import { findDatasetById } from "@/lib/dataset-directory";

/**
 * A real upload is one synchronous HTTP request — there's no queue or
 * worker in this stack. `onProgress` is kept only for interface parity
 * with the mock/HTTP implementations and is never actually invoked here;
 * the progress bar a user sees during a real upload is the browser's own
 * XHR transfer progress, synthesized entirely client-side in
 * `HttpUploadService`. Don't "fix" that asymmetry by inventing fake
 * server-side milestones — there's nothing real for them to represent.
 */
export class MongoUploadService implements UploadService {
  async uploadFile(
    context: TenantContext,
    file: File,
    request: UploadRequest,
    _onProgress?: UploadProgressHandler,
  ): Promise<UploadResult> {
    const dataset = await findDatasetById(request.datasetId);
    const schemaVersion = dataset?.version ?? "unknown";

    if (!isAcceptedUploadFile(request.filename) || request.fileSize > MAX_UPLOAD_SIZE_BYTES) {
      const message = !isAcceptedUploadFile(request.filename)
        ? `Unsupported file type. Accepted types: ${ACCEPTED_UPLOAD_EXTENSIONS.join(", ")}`
        : `File exceeds the maximum size of ${MAX_UPLOAD_SIZE_BYTES} bytes.`;

      const exchange = await createExchange(context.tenantId, {
        datasetId: request.datasetId,
        direction: ExchangeDirection.INBOUND,
        status: ExchangeStatus.FAILED,
        filename: request.filename,
        fileSize: request.fileSize,
        recordCount: 0,
        schemaVersion,
        storageFileId: null,
        completedAt: new Date().toISOString(),
        errorCount: 1,
        validationErrors: [{ field: "file", message }],
      });

      await createNotification(context.tenantId, {
        type: NotificationType.EXCHANGE_FAILED,
        title: "Upload failed validation",
        message: `${request.filename} could not be processed: ${message}`,
      });

      return toUploadResult(exchange);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const recordCount = countRecords(request.filename, buffer);
    const storageFileId = await storeFile(request.filename, request.fileType || "application/octet-stream", buffer);

    const exchange = await createExchange(context.tenantId, {
      datasetId: request.datasetId,
      direction: ExchangeDirection.INBOUND,
      status: ExchangeStatus.COMPLETED,
      filename: request.filename,
      fileSize: request.fileSize,
      recordCount,
      schemaVersion,
      storageFileId,
      completedAt: new Date().toISOString(),
    });

    // Phase-1-going-real stand-in: this repo has no Bronze -> Silver ->
    // Gold transform pipeline, so the "processed output" made available
    // for download is literally the uploaded file, echoed back under the
    // same storage id — not a modeled business rule. A real pipeline
    // would replace this block with the actual generated output.
    const download = await createDownload(context.tenantId, {
      datasetId: request.datasetId,
      filename: request.filename,
      format: formatFor(request.filename),
      sizeBytes: request.fileSize,
      storageFileId,
      sourceExchangeId: exchange.id,
    });

    await createExchange(context.tenantId, {
      datasetId: request.datasetId,
      direction: ExchangeDirection.OUTBOUND,
      status: ExchangeStatus.COMPLETED,
      filename: download.filename,
      fileSize: download.sizeBytes,
      recordCount,
      schemaVersion,
      storageFileId,
      completedAt: new Date().toISOString(),
    });

    await createNotification(context.tenantId, {
      type: NotificationType.EXCHANGE_COMPLETED,
      title: "Upload processed successfully",
      message: `${request.filename} was validated and is now available for download.`,
    });

    return toUploadResult(exchange);
  }
}

function toUploadResult(exchange: Exchange): UploadResult {
  const failed = exchange.status === ExchangeStatus.FAILED;
  return {
    uploadId: exchange.id,
    status: failed ? UploadStatus.FAILED : UploadStatus.COMPLETED,
    filename: exchange.filename,
    datasetId: exchange.datasetId,
    progress: 100,
    message: failed ? exchange.validationErrors[0]?.message : "File processed successfully.",
  };
}

function formatFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".json")) return "JSON";
  if (lower.endsWith(".parquet")) return "Parquet";
  return "Unknown";
}

/**
 * Real record counts for the formats that are trivially parseable
 * without a new dependency. `.parquet` is a binary columnar format with
 * no parser available in this project (adding one is out of scope) — 0
 * here means "not computed for this format", not "empty file".
 */
function countRecords(filename: string, buffer: Buffer): number {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".csv")) {
    const text = buffer.toString("utf-8").trim();
    if (!text) return 0;
    const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
    return Math.max(lines.length - 1, 0);
  }

  if (lower.endsWith(".json")) {
    try {
      const parsed = JSON.parse(buffer.toString("utf-8"));
      return Array.isArray(parsed) ? parsed.length : 1;
    } catch {
      return 0;
    }
  }

  return 0;
}
