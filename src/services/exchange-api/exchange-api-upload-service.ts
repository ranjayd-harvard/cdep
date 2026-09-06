import { UploadStatus, type UploadRequest, type UploadResult } from "@/models";
import type { UploadProgressHandler, UploadService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { env } from "@/config/env";
import {
  completeUpload,
  getExchange,
  getExchangeValidation,
  initiateUpload,
  publishFixture,
  putToSignedUrl,
} from "@/lib/exchange-service/client";
import { mapUploadStatus } from "@/lib/exchange-service/status-mapping";

/**
 * data-exchange-service-backed `UploadService`.
 *
 * KNOWN ARCHITECTURE DEVIATION (documented, not accidental — see
 * `docs/exchange-service-integration.md` § "Upload path: proxied, not
 * direct-to-storage"): data-exchange-service's own design explicitly
 * wants browsers PUTting straight to the signed URL, never through the
 * service. This class still receives the *whole file* server-side first
 * (via `/api/uploads`'s existing multipart handler — see that route),
 * because rewiring `upload-form.tsx`/`HttpUploadService` to do a
 * two-step direct-to-storage upload is a separate, larger frontend
 * change. What happens here is a faithful, fully-real exchange lifecycle
 * (real exchange row, real MinIO object, real manifest, real validation)
 * with one extra hop: browser -> Next.js server -> signed URL -> MinIO,
 * instead of browser -> signed URL -> MinIO directly. Fine for the file
 * sizes this portal accepts (`MAX_UPLOAD_SIZE_BYTES`, currently well
 * under what would make the extra hop actually cost anything).
 */
export class ExchangeApiUploadService implements UploadService {
  async uploadFile(
    context: TenantContext,
    file: File,
    request: UploadRequest,
    _onProgress?: UploadProgressHandler,
  ): Promise<UploadResult> {
    const contentType = request.fileType || "application/octet-stream";

    const initiated = await initiateUpload(context, {
      dataProductId: request.datasetId,
      filename: request.filename,
      contentType,
      sizeBytes: request.fileSize,
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    await putToSignedUrl(initiated.upload.url, contentType, buffer);

    await completeUpload(context, initiated.exchangeId);
    const detail = await getExchange(context, initiated.exchangeId);
    const status = mapUploadStatus(detail.status);

    let message: string | undefined;
    if (status === UploadStatus.FAILED) {
      message = await getExchangeValidation(context, initiated.exchangeId)
        .then((v) => {
          const first = v.errors[0];
          return first ? `Row ${first.row}, field "${first.field}": ${first.code}` : "File failed validation.";
        })
        .catch(() => "File failed validation.");
    } else if (status === UploadStatus.COMPLETED) {
      message = "File processed successfully.";
      await this.publishProcessedOutput(context, request);
    }

    return {
      uploadId: initiated.exchangeId,
      status,
      filename: request.filename,
      datasetId: request.datasetId,
      progress: 100,
      message,
    };
  }

  /**
   * Mirrors what `MongoUploadService` fakes today (see that file's own
   * comment): with no real Bronze -> Silver -> Gold pipeline, "the
   * processed output available for download" is a stand-in, not a
   * transform of the actual uploaded bytes — data-exchange-service's
   * `/internal/v1/publications` fixture endpoint plays that role here
   * instead of echoing the upload. Best-effort: a failure here must not
   * fail the upload itself (the upload genuinely succeeded), so this
   * only logs.
   */
  private async publishProcessedOutput(context: TenantContext, request: UploadRequest): Promise<void> {
    if (!env.exchangeServiceInternalApiKey) return;
    try {
      await publishFixture({
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        dataProductId: request.datasetId,
        filename: request.filename,
      });
    } catch (err) {
      console.warn("[ExchangeApiUploadService] publishProcessedOutput failed (non-fatal):", err);
    }
  }
}
