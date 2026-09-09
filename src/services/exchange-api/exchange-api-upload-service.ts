import { UploadStatus, type UploadRequest, type UploadResult } from "@/models";
import type { UploadProgressHandler, UploadService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { env } from "@/config/env";
import {
  completeUpload,
  enqueuePipelineJob,
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
      await this.publishProcessedOutput(context, request, initiated.exchangeId);
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
   * Two mutually exclusive ways to make "processed output" show up as an
   * OUTBOUND exchange after a completed upload, chosen by
   * `env.demoFixturePublishEnabled`:
   *
   * - true (default): mirrors what `MongoUploadService` fakes today (see
   *   that file's own comment) — data-exchange-service's
   *   `/internal/v1/publications` fixture endpoint stands in for the real
   *   Bronze -> Silver -> Gold pipeline, echoing a small deterministic
   *   sample instead of a transform of the actual uploaded bytes.
   * - false: enqueues a real pipeline job (`/internal/v1/pipeline-jobs`)
   *   instead. data-exchange-service's own worker decides when to run the
   *   real Bronze -> Silver -> Gold -> Publish chain and produces a genuine
   *   OUTBOUND exchange from real Gold output — on its own schedule, not
   *   synchronously with this upload request.
   *
   * Best-effort either way: a failure here must not fail the upload itself
   * (the upload genuinely succeeded), so this only logs.
   */
  private async publishProcessedOutput(
    context: TenantContext,
    request: UploadRequest,
    exchangeId: string,
  ): Promise<void> {
    if (!env.exchangeServiceInternalApiKey) return;
    try {
      if (env.demoFixturePublishEnabled) {
        await publishFixture({
          organizationId: context.organizationId,
          tenantId: context.tenantId,
          dataProductId: request.datasetId,
          filename: request.filename,
        });
      } else {
        await enqueuePipelineJob({
          organizationId: context.organizationId,
          tenantId: context.tenantId,
          dataProductId: request.datasetId,
          exchangeId,
        });
      }
    } catch (err) {
      console.warn("[ExchangeApiUploadService] publishProcessedOutput failed (non-fatal):", err);
    }
  }
}
