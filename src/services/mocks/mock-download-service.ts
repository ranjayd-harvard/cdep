import type { DownloadableFile } from "@/models";
import type { DownloadService } from "@/services/interfaces";
import { MOCK_DOWNLOADS } from "@/data/mocks/downloads";
import { DEFAULT_TENANT_ID } from "@/data/mocks/tenants";
import { simulateLatency } from "@/lib/simulate";

export class MockDownloadService implements DownloadService {
  async getDownloads(tenantId: string): Promise<DownloadableFile[]> {
    await simulateLatency();
    if (tenantId !== DEFAULT_TENANT_ID) return [];
    return MOCK_DOWNLOADS;
  }

  async getDownloadUrl(tenantId: string, fileId: string): Promise<string> {
    await simulateLatency(150);
    if (tenantId !== DEFAULT_TENANT_ID) {
      throw new Error("File not found for this tenant.");
    }
    const file = MOCK_DOWNLOADS.find((item) => item.id === fileId);
    if (!file) throw new Error("File not found.");
    // Mock signed URL — a real implementation would return a short-lived,
    // pre-signed object storage URL scoped to the caller's tenant.
    return `https://downloads.example.com/mock/${tenantId}/${file.filename}`;
  }
}
