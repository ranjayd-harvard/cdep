import type { DownloadableFile } from "@/models";
import type { DownloadService } from "@/services/interfaces";
import { httpGet } from "@/lib/http-client";

/**
 * Tenant identity is never sent over the wire here — it's derived
 * server-side from the session by `requireApiTenantContext()` in every
 * `/api/downloads/*` route handler. `getDownloads` has no matching list
 * route today: nothing client-side calls it (`(portal)/downloads/page.tsx`
 * is a Server Component reading `services.downloads` directly), so it's
 * left pointed at the same-shaped endpoint a real backend would offer
 * rather than implemented.
 */
export class HttpDownloadService implements DownloadService {
  getDownloads(_tenantId: string): Promise<DownloadableFile[]> {
    return httpGet<DownloadableFile[]>(`/api/downloads`);
  }

  getDownloadUrl(_tenantId: string, fileId: string): Promise<string> {
    return httpGet<string>(`/api/downloads/${encodeURIComponent(fileId)}/url`);
  }
}
