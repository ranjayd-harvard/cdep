export interface DownloadableFile {
  id: string;
  datasetId: string;
  filename: string;
  format: string;
  generatedAt: string;
  sizeBytes: number;
  expiresAt: string;
}
