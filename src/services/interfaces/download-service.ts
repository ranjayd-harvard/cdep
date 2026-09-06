import type { DownloadableFile } from "@/models";
import type { TenantContext } from "@/lib/tenant";

/** Takes the full `TenantContext` — see the same note on `ExchangeService`. */
export interface DownloadService {
  getDownloads(context: TenantContext): Promise<DownloadableFile[]>;
  getDownloadUrl(context: TenantContext, fileId: string): Promise<string>;
}
