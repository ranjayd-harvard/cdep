import type { DownloadableFile } from "@/models";
import type { DownloadService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { listDownloads, getDownloadById } from "@/lib/download-directory";
import { createDownloadToken } from "@/lib/download-tokens";

const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

export class MongoDownloadService implements DownloadService {
  getDownloads(context: TenantContext): Promise<DownloadableFile[]> {
    return listDownloads(context.tenantId);
  }

  async getDownloadUrl(context: TenantContext, fileId: string): Promise<string> {
    const file = await getDownloadById(context.tenantId, fileId);
    if (!file) {
      throw new Error("File not found for this tenant.");
    }
    const token = await createDownloadToken(context.tenantId, fileId, DOWNLOAD_URL_TTL_MS);
    return `/api/downloads/${encodeURIComponent(fileId)}/file?token=${token}`;
  }
}
