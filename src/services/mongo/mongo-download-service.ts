import type { DownloadableFile } from "@/models";
import type { DownloadService } from "@/services/interfaces";
import { listDownloads, getDownloadById } from "@/lib/download-directory";
import { createDownloadToken } from "@/lib/download-tokens";

const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

export class MongoDownloadService implements DownloadService {
  getDownloads(tenantId: string): Promise<DownloadableFile[]> {
    return listDownloads(tenantId);
  }

  async getDownloadUrl(tenantId: string, fileId: string): Promise<string> {
    const file = await getDownloadById(tenantId, fileId);
    if (!file) {
      throw new Error("File not found for this tenant.");
    }
    const token = await createDownloadToken(tenantId, fileId, DOWNLOAD_URL_TTL_MS);
    return `/api/downloads/${encodeURIComponent(fileId)}/file?token=${token}`;
  }
}
