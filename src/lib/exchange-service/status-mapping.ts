import { ExchangeStatus, UploadStatus } from "@/models";

/**
 * data-exchange-service models a richer exchange lifecycle (12 inbound +
 * 5 outbound statuses — PENDING_UPLOAD, VALIDATING, QUEUED_FOR_INGESTION,
 * PREPARING, READY, DOWNLOADED, ...) than cdep's `Exchange.status`, which
 * predates this integration and only has 5 values (RECEIVED, VALIDATING,
 * PROCESSING, COMPLETED, FAILED — see `src/models/exchange.ts`). Rather
 * than widen cdep's status enum (a much larger UI change — `StatusBadge`,
 * dashboard filtering, etc. all switch on it), this collapses the richer
 * set onto the narrower one. The full-fidelity status string is still
 * available from `getExchange`'s raw response if a future UI needs it —
 * see `docs/exchange-service-integration.md` § "Status/model mismatches".
 */
export function mapExchangeStatus(remoteStatus: string): ExchangeStatus {
  switch (remoteStatus) {
    case "PENDING_UPLOAD":
    case "UPLOADING":
    case "RECEIVED":
      return ExchangeStatus.RECEIVED;
    case "VALIDATING":
      return ExchangeStatus.VALIDATING;
    // VALIDATED is the actual terminal success state for every inbound
    // exchange this integration produces (see the matching comment on
    // `mapUploadStatus` below) — nothing moves it to QUEUED_FOR_INGESTION/
    // PROCESSING without a future async ingestion pipeline that doesn't
    // exist yet. Mapping it to PROCESSING here was a real bug: the
    // dashboard's `activeStatuses` filter (RECEIVED/VALIDATING/PROCESSING)
    // would then count every successfully completed upload as
    // perpetually "active", and `completedThisMonth` would never see it.
    case "VALIDATED":
      return ExchangeStatus.COMPLETED;
    case "QUEUED_FOR_INGESTION":
    case "PROCESSING":
    case "PREPARING":
      return ExchangeStatus.PROCESSING;
    case "COMPLETED":
    case "READY":
    case "DOWNLOADED":
      return ExchangeStatus.COMPLETED;
    case "VALIDATION_FAILED":
    case "FAILED":
    case "CANCELLED":
    case "EXPIRED":
      return ExchangeStatus.FAILED;
    default:
      return ExchangeStatus.FAILED;
  }
}

export function mapUploadStatus(remoteStatus: string): UploadStatus {
  switch (remoteStatus) {
    case "PENDING_UPLOAD":
    case "UPLOADING":
      return UploadStatus.UPLOADING;
    case "RECEIVED":
    case "VALIDATING":
      return UploadStatus.VALIDATING;
    // VALIDATED is the actual terminal success state `ExchangeApiUploadService`
    // ever observes: `/v1/uploads/{id}/complete` runs validation
    // synchronously and returns VALIDATED or VALIDATION_FAILED, full stop
    // — there is no async worker in this integration that later moves an
    // exchange to QUEUED_FOR_INGESTION/PROCESSING/COMPLETED. Mapping it to
    // UploadStatus.PROCESSING (as mapExchangeStatus does, for the exchange
    // *list/detail* views) would leave the upload form showing "still
    // processing" forever and would also skip
    // `ExchangeApiUploadService.publishProcessedOutput`, which only fires
    // on COMPLETED. QUEUED_FOR_INGESTION/PROCESSING are kept mapped to
    // PROCESSING for forward-compatibility, in case a future async
    // pipeline does reach this code path.
    case "VALIDATED":
      return UploadStatus.COMPLETED;
    case "QUEUED_FOR_INGESTION":
    case "PROCESSING":
      return UploadStatus.PROCESSING;
    case "COMPLETED":
      return UploadStatus.COMPLETED;
    default:
      return UploadStatus.FAILED;
  }
}
