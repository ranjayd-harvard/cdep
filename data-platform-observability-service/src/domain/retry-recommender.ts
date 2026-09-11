import type { OperationalStage } from "../config/constants.js";

// Which sibling service actually owns retrying work at a given normalized
// stage (spec section 20) — Phase 9 recommends, it never executes a retry
// itself.
const RETRY_OWNER_BY_STAGE: Record<OperationalStage, string> = {
  EXCHANGE_RECEIVED: "data-exchange-service",
  EXCHANGE_VALIDATION: "data-exchange-service",
  BRONZE_INGESTION: "data-lakehouse",
  SILVER_TRANSFORMATION: "data-lakehouse",
  GOLD_PRODUCT_BUILD: "data-lakehouse",
  QUALITY_VALIDATION: "data-lakehouse",
  PUBLICATION: "data-publication-service",
  OUTBOUND_EXCHANGE: "data-exchange-service",
  FILE_DELIVERY: "data-exchange-service",
  API_DELIVERY: "data-product-api-service",
};

// Failure categories that indicate the failure won't resolve on a bare
// retry — a human/config fix is needed first. Anything else is treated as
// possibly transient and worth recommending a retry for.
const NON_RETRIABLE_ERROR_CATEGORIES = new Set([
  "PERMANENT_CONFIGURATION_FAILURE",
  "ACCESS_DENIED",
  "VALIDATION_ERROR",
  "CONTRACT_VIOLATION",
]);

export interface RetryRecommendation {
  executionId: string;
  failedStage: OperationalStage;
  retryRecommended: boolean;
  retryOwner: string;
  reason: string;
  safeFromStage: OperationalStage;
}

export function recommendRetry(params: {
  executionId: string;
  failedStage: OperationalStage;
  errorCategory: string | null;
  errorMessage: string | null;
}): RetryRecommendation {
  const retryOwner = RETRY_OWNER_BY_STAGE[params.failedStage];
  const nonRetriable = params.errorCategory ? NON_RETRIABLE_ERROR_CATEGORIES.has(params.errorCategory) : false;

  return {
    executionId: params.executionId,
    failedStage: params.failedStage,
    retryRecommended: !nonRetriable,
    retryOwner,
    reason: nonRetriable
      ? `Non-retriable failure (${params.errorCategory ?? "unknown"}) — requires intervention before retrying.`
      : (params.errorMessage ?? `Transient failure at ${params.failedStage}; a retry from ${retryOwner} is likely to succeed.`),
    safeFromStage: params.failedStage,
  };
}
