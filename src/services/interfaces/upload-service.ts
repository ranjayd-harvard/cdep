import type { UploadRequest, UploadResult } from "@/models";

export type UploadProgressHandler = (result: UploadResult) => void;

export interface UploadService {
  uploadFile(
    tenantId: string,
    file: File,
    request: UploadRequest,
    onProgress?: UploadProgressHandler,
  ): Promise<UploadResult>;
}
