import type { DownloadableFile } from "@/models";
import type { DownloadService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import {
  getExchange as fetchExchangeDetail,
  listExchanges,
  requestDownloadUrl,
} from "@/lib/exchange-service/client";

const DOWNLOAD_TTL_MS = 5 * 60 * 1000; // matches SIGNED_DOWNLOAD_URL_TTL_SECONDS default (300s)

/**
 * data-exchange-service-backed `DownloadService`. Only OUTBOUND, READY
 * exchanges are downloadable — that's the same rule
 * `POST /v1/downloads/{id}/url` enforces server-side (see that service's
 * `download.service.ts`); this mirrors it client-visibly so the Downloads
 * page doesn't list files that would 409 if clicked.
 */
export class ExchangeApiDownloadService implements DownloadService {
  async getDownloads(context: TenantContext): Promise<DownloadableFile[]> {
    const { items } = await listExchanges(context, { direction: "OUTBOUND", status: "READY", limit: 100 });

    const detailed = await Promise.all(
      items.map((item) => fetchExchangeDetail(context, item.exchangeId).catch(() => null)),
    );

    return detailed
      .filter((detail) => detail !== null && detail.file !== null)
      .map((detail): DownloadableFile => ({
        id: detail!.exchangeId,
        datasetId: detail!.dataProduct.id,
        filename: detail!.file!.filename,
        format: detail!.file!.format,
        generatedAt: detail!.completedAt ?? detail!.receivedAt ?? new Date().toISOString(),
        sizeBytes: detail!.file!.sizeBytes,
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL_MS).toISOString(),
      }));
  }

  async getDownloadUrl(context: TenantContext, fileId: string): Promise<string> {
    // Returned verbatim — an absolute, short-lived MinIO URL, not a path
    // on this app. `download-button.tsx`'s `window.location.assign(url)`
    // and the `/api/downloads/[fileId]/url` route's `NextResponse.json(url)`
    // both work identically whether this is a relative portal path
    // (Mongo-backed) or an absolute object-storage URL (this one) —
    // `env.exchangeServiceUrl` is what selects between them in
    // `src/services/index.ts`, which is also what decides whether this
    // class is ever constructed in the first place.
    const result = await requestDownloadUrl(context, fileId);
    return result.downloadUrl;
  }
}
