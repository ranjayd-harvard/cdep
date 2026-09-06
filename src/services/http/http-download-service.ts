import type { DownloadableFile } from "@/models";
import type { DownloadService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { httpGet } from "@/lib/http-client";

/**
 * Tenant identity is never sent over the wire here — it's derived
 * server-side from the session by `requireApiTenantContext()` in every
 * `/api/downloads/*` route handler. `getDownloads` has no matching list
 * route today: nothing client-side calls it (`(portal)/downloads/page.tsx`
 * is a Server Component reading `services.downloads` directly), so it's
 * left pointed at the same-shaped endpoint a real backend would offer
 * rather than implemented. `getDownloadUrl` IS real and exercised by
 * `download-button.tsx` — as of the exchange-service integration, the
 * `/api/downloads/[fileId]/url` route it calls can return either a
 * portal-issued token URL (Mongo-backed) or a data-exchange-service
 * signed MinIO URL, transparently — this file doesn't need to know which.
 */
export class HttpDownloadService implements DownloadService {
  getDownloads(_context: TenantContext): Promise<DownloadableFile[]> {
    return httpGet<DownloadableFile[]>(`/api/downloads`);
  }

  getDownloadUrl(_context: TenantContext, fileId: string): Promise<string> {
    return httpGet<string>(`/api/downloads/${encodeURIComponent(fileId)}/url`);
  }
}
