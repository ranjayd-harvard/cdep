import { AppError, notFoundError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import type { RequestContext } from "../../auth/request-context.js";
import { appendExchangeEvent } from "../../events/exchange-event.service.js";
import { assertDownloadEntitlement } from "../data-products/data-product.service.js";
import { getExchangeById, getExchangeFileByRole, updateExchangeStatus } from "../exchanges/exchange.repository.js";
import { objectStorage } from "../../storage/index.js";

export interface DownloadUrlResult {
  exchangeId: string;
  filename: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

// Verification order mirrors AGENTS.md section 38 exactly: authenticated
// user -> org membership -> active tenant -> exchange ownership -> OUTBOUND
// direction -> READY status -> data product entitlement -> not expired.
// Ownership/org/tenant checks happen implicitly via getExchangeById's
// mandatory organization_id/tenant_id predicate (section 30): a cross-tenant
// exchange simply does not come back, so it is indistinguishable from
// "does not exist" (section 47).
export async function requestDownloadUrl(ctx: RequestContext, exchangeId: string): Promise<DownloadUrlResult> {
  const exchange = await getExchangeById(exchangeId, ctx.organizationId, ctx.activeTenantId);
  if (!exchange) throw notFoundError();

  if (exchange.direction !== "OUTBOUND") {
    throw notFoundError();
  }

  if (exchange.expires_at && exchange.expires_at.getTime() < Date.now()) {
    if (exchange.status !== "EXPIRED") {
      await updateExchangeStatus(exchangeId, ctx.organizationId, ctx.activeTenantId, "EXPIRED");
      await appendExchangeEvent({
        exchangeId,
        eventType: "EXCHANGE_EXPIRED",
        fromStatus: exchange.status,
        toStatus: "EXPIRED",
        actorType: "SYSTEM",
      });
    }
    throw new AppError("EXCHANGE_EXPIRED", "This exchange has expired and is no longer available for download.");
  }

  if (exchange.status !== "READY") {
    throw new AppError("INVALID_STATE_TRANSITION", `Exchange is not ready for download (status: ${exchange.status}).`);
  }

  await assertDownloadEntitlement(ctx.activeTenantId, exchange.data_product_id);

  const dataFile = await getExchangeFileByRole(exchangeId, "DATA");
  if (!dataFile) {
    throw new AppError("CONFLICT", "Exchange has no associated data file.");
  }

  const filename = dataFile.original_filename ?? "download";
  const signed = await objectStorage.createDownloadUrl({
    bucket: dataFile.bucket_name,
    key: dataFile.object_key,
    expiresInSeconds: env.SIGNED_DOWNLOAD_URL_TTL_SECONDS,
    downloadFilename: filename,
  });

  await appendExchangeEvent({
    exchangeId,
    eventType: "DOWNLOAD_URL_ISSUED",
    actorType: ctx.role === "SERVICE_ACCOUNT" ? "SERVICE_ACCOUNT" : "USER",
    actorId: ctx.userId,
    eventData: { expiresInSeconds: signed.expiresInSeconds },
  });

  return { exchangeId, filename, downloadUrl: signed.url, expiresInSeconds: signed.expiresInSeconds };
}
