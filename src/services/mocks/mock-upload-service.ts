import { UploadStatus, type UploadRequest, type UploadResult } from "@/models";
import type { UploadProgressHandler, UploadService } from "@/services/interfaces";
import { DEFAULT_TENANT_ID } from "@/data/mocks/tenants";
import { simulateLatency } from "@/lib/simulate";

const STAGES: Array<{ status: UploadStatus; progress: number; delayMs: number }> = [
  { status: UploadStatus.UPLOADING, progress: 35, delayMs: 400 },
  { status: UploadStatus.VALIDATING, progress: 65, delayMs: 400 },
  { status: UploadStatus.PROCESSING, progress: 90, delayMs: 400 },
  { status: UploadStatus.COMPLETED, progress: 100, delayMs: 300 },
];

let uploadSequence = 0;

export class MockUploadService implements UploadService {
  async uploadFile(
    tenantId: string,
    _file: File,
    request: UploadRequest,
    onProgress?: UploadProgressHandler,
  ): Promise<UploadResult> {
    if (tenantId !== DEFAULT_TENANT_ID) {
      throw new Error("Cannot upload data for an unrecognized tenant.");
    }

    uploadSequence += 1;
    const uploadId = `upload-${String(uploadSequence).padStart(4, "0")}`;

    let latest: UploadResult = {
      uploadId,
      status: UploadStatus.UPLOADING,
      filename: request.filename,
      datasetId: request.datasetId,
      progress: 0,
    };
    onProgress?.(latest);

    for (const stage of STAGES) {
      await simulateLatency(stage.delayMs);
      latest = {
        uploadId,
        status: stage.status,
        filename: request.filename,
        datasetId: request.datasetId,
        progress: stage.progress,
        message:
          stage.status === UploadStatus.COMPLETED
            ? "File processed successfully."
            : undefined,
      };
      onProgress?.(latest);
    }

    return latest;
  }
}
