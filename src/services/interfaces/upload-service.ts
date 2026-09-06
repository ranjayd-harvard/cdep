import type { UploadRequest, UploadResult } from "@/models";
import type { TenantContext } from "@/lib/tenant";

export type UploadProgressHandler = (result: UploadResult) => void;

/**
 * Takes the full `TenantContext` — see the same note on
 * `ExchangeService`. `HttpUploadService` (client-side) also switched to
 * this shape for consistency even though it only forwards to
 * `/api/uploads`, which re-derives its own context server-side and
 * ignores whatever the client sent.
 */
export interface UploadService {
  uploadFile(
    context: TenantContext,
    file: File,
    request: UploadRequest,
    onProgress?: UploadProgressHandler,
  ): Promise<UploadResult>;
}
