import { UploadStatus, type UploadRequest, type UploadResult } from "@/models";
import type { UploadProgressHandler, UploadService } from "@/services/interfaces";

/**
 * The one HTTP service that can't use `httpGet`/`httpPost` (JSON-only):
 * a real upload needs multipart encoding and, since `fetch` has no
 * upload-progress event, `XMLHttpRequest` for real browser transfer
 * progress. Progress is capped at 90% until the server responds — the
 * remaining 10% represents server-side processing time, which has no
 * real mid-request signal to report (see `MongoUploadService`'s doc
 * comment).
 */
export class HttpUploadService implements UploadService {
  uploadFile(
    _tenantId: string,
    file: File,
    request: UploadRequest,
    onProgress?: UploadProgressHandler,
  ): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file, request.filename);
      formData.append("datasetId", request.datasetId);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        onProgress?.({
          uploadId: "pending",
          status: UploadStatus.UPLOADING,
          filename: request.filename,
          datasetId: request.datasetId,
          progress: Math.min(Math.round((event.loaded / event.total) * 90), 90),
        });
      });

      xhr.addEventListener("load", () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Upload failed with status ${xhr.status}`));
          return;
        }
        try {
          const result = JSON.parse(xhr.responseText) as UploadResult;
          onProgress?.(result);
          resolve(result);
        } catch {
          reject(new Error("Upload response was not valid JSON."));
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Upload failed due to a network error.")));

      xhr.send(formData);
    });
  }
}
