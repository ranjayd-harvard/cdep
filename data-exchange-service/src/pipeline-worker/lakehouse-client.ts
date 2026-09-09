import { env } from "../config/env.js";

/**
 * Outbound client for data-lakehouse's own internal HTTP API
 * (`src/lakehouse/api/` in that repo). Structurally identical to cdep's own
 * `src/lib/lakehouse-service/client.ts` (same fetch-wrapper shape,
 * `x-internal-api-key` header, defensive non-JSON-error parsing) but scoped
 * to only the calls the pipeline worker needs. Used only by
 * ./pipeline-worker.service.ts.
 */

export class LakehouseServiceError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "LakehouseServiceError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorDetail {
  detail?: { error_code?: string; message?: string } | string;
}

async function lakehouseServiceFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!env.LAKEHOUSE_SERVICE_URL) {
    throw new LakehouseServiceError(0, "NOT_CONFIGURED", "LAKEHOUSE_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-key": env.LAKEHOUSE_SERVICE_INTERNAL_API_KEY ?? "",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.LAKEHOUSE_SERVICE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  // A 5xx from an unhandled server-side exception isn't JSON at all --
  // FastAPI's default error middleware returns a plain text body. Never let
  // that crash the caller with a JSON.parse SyntaxError.
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const envelope = json as ErrorDetail | undefined;
    const detail = typeof envelope?.detail === "object" ? envelope.detail : undefined;
    const message =
      detail?.message ??
      (typeof envelope?.detail === "string" ? envelope.detail : undefined) ??
      (json === undefined && text ? text : undefined);
    throw new LakehouseServiceError(
      response.status,
      detail?.error_code,
      message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return json as T;
}

export interface IngestionOutcome {
  ingestion_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
}

export function triggerIngestion(exchangeId: string): Promise<IngestionOutcome> {
  return lakehouseServiceFetch<IngestionOutcome>("/internal/v1/ingestion-runs", {
    method: "POST",
    body: { exchange_id: exchangeId },
  });
}

export interface PipelineOutcome {
  pipeline_run_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
}

export function triggerBronzeToSilver(ingestionId: string): Promise<PipelineOutcome> {
  return lakehouseServiceFetch<PipelineOutcome>("/internal/v1/pipeline-runs/bronze-to-silver", {
    method: "POST",
    body: { ingestion_id: ingestionId, reprocess: false },
  });
}

// Deliberately never sends `product_id`: the worker only knows the source
// (Bronze) data product id, not which Gold product(s) it feeds -- that
// mapping is exactly what `BRONZE_TO_SILVER_PIPELINES[bronze_id].gold_products`
// already encodes. Omitting `product_id` makes data-lakehouse's own route
// resolve it that way from `silver_run_id` (see
// data-lakehouse/src/lakehouse/api/routes.py's trigger_silver_to_gold) --
// the response array has one entry per registered gold product for that
// Bronze pipeline (one, for every registration in this codebase today).
export function triggerSilverToGold(silverRunId: string): Promise<PipelineOutcome[]> {
  return lakehouseServiceFetch<PipelineOutcome[]>("/internal/v1/pipeline-runs/silver-to-gold", {
    method: "POST",
    body: { silver_run_id: silverRunId, reprocess: false },
  });
}
