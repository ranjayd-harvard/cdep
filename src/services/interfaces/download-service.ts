import type { DownloadableFile } from "@/models";

export interface DownloadService {
  getDownloads(tenantId: string): Promise<DownloadableFile[]>;
  getDownloadUrl(tenantId: string, fileId: string): Promise<string>;
}
