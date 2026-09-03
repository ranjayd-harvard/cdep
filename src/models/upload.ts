export const UploadStatus = {
  IDLE: "IDLE",
  UPLOADING: "UPLOADING",
  VALIDATING: "VALIDATING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type UploadStatus = (typeof UploadStatus)[keyof typeof UploadStatus];

export interface UploadRequest {
  datasetId: string;
  filename: string;
  fileSize: number;
  fileType: string;
}

export interface UploadResult {
  uploadId: string;
  status: UploadStatus;
  filename: string;
  datasetId: string;
  progress: number;
  message?: string;
}
