import { env } from "@/config/env";

/**
 * Server-only client for data-lakehouse's own internal HTTP API
 * (`src/lakehouse/api/` in that repo). Structurally like
 * `src/lib/exchange-service/client.ts`, but simpler: data-lakehouse has no
 * tenant-JWT concept at all — every call is gated by `x-internal-api-key`
 * only. Used only by `src/services/lakehouse-admin/*`, wired into the
 * server registry (`src/services/index.ts`), never imported from a "use
 * client" component.
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
  if (!env.lakehouseServiceEnabled) {
    throw new LakehouseServiceError(0, "NOT_CONFIGURED", "LAKEHOUSE_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-key": env.lakehouseServiceInternalApiKey,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.lakehouseServiceUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  // A 5xx from an unhandled server-side exception (as opposed to a
  // deliberate `HTTPException`) isn't JSON at all -- FastAPI's default
  // error middleware returns a plain "Internal Server Error" body. Never
  // let that crash the caller with a JSON.parse SyntaxError; surface it as
  // a normal LakehouseServiceError instead.
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

export interface IngestionRunDTO {
  ingestion_id: string;
  exchange_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  schema_version: string;
  bronze_table: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  source_record_count: number | null;
  bronze_record_count: number | null;
  rejected_record_count: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export function listIngestionRunsByExchange(exchangeId: string): Promise<IngestionRunDTO[]> {
  return lakehouseServiceFetch<IngestionRunDTO[]>(
    `/internal/v1/ingestion-runs?exchange_id=${encodeURIComponent(exchangeId)}`,
  );
}

export interface IngestionOutcomeDTO {
  ingestion_id: string;
  exchange_id: string;
  status: string;
  bronze_table: string | null;
  source_record_count: number;
  bronze_record_count: number;
  rejected_record_count: number;
  error_code: string | null;
  error_message: string | null;
}

export function triggerIngestion(exchangeId: string): Promise<IngestionOutcomeDTO> {
  return lakehouseServiceFetch<IngestionOutcomeDTO>("/internal/v1/ingestion-runs", {
    method: "POST",
    body: { exchange_id: exchangeId },
  });
}

// --- Phase 3: pipeline runs (Bronze->Silver / Silver->Gold) ----------------

export interface PipelineRunDTO {
  pipeline_run_id: string;
  pipeline_name: string;
  pipeline_type: "BRONZE_TO_SILVER" | "SILVER_TO_GOLD";
  organization_id: string;
  tenant_id: string;
  source_table: string;
  target_table: string;
  source_exchange_id: string | null;
  source_ingestion_id: string | null;
  source_pipeline_run_id: string | null;
  data_product_id: string | null;
  pipeline_version: string;
  contract_version: string;
  mapping_version: string | null;
  source_snapshot_id: string | null;
  target_snapshot_id: string | null;
  status: string;
  input_record_count: number | null;
  output_record_count: number | null;
  rejected_record_count: number | null;
  started_at: string;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PipelineOutcomeDTO {
  pipeline_run_id: string;
  pipeline_type: string;
  status: string;
  source_table: string | null;
  target_table: string | null;
  input_record_count: number;
  output_record_count: number;
  rejected_record_count: number;
  error_code: string | null;
  error_message: string | null;
}

export interface QualityResultDTO {
  layer: string;
  table_name: string;
  rule_name: string;
  severity: string;
  total_count: number;
  failed_count: number;
  failure_percentage: number;
  passed: boolean;
  evaluated_at: string;
}

export interface LineageEdgeDTO {
  source_type: string;
  source_identifier: string;
  target_type: string;
  target_identifier: string;
  created_at: string;
}

export interface PipelineRunDetailDTO {
  run: PipelineRunDTO;
  quality_results: QualityResultDTO[];
  lineage_edges: LineageEdgeDTO[];
}

export function listPipelineRuns(params: {
  ingestionId?: string;
  sourcePipelineRunId?: string;
  limit?: number;
}): Promise<PipelineRunDTO[]> {
  const search = new URLSearchParams();
  if (params.ingestionId) search.set("ingestion_id", params.ingestionId);
  if (params.sourcePipelineRunId) search.set("source_pipeline_run_id", params.sourcePipelineRunId);
  if (params.limit) search.set("limit", String(params.limit));
  return lakehouseServiceFetch<PipelineRunDTO[]>(`/internal/v1/pipeline-runs?${search.toString()}`);
}

export function getPipelineRunDetail(pipelineRunId: string): Promise<PipelineRunDetailDTO> {
  return lakehouseServiceFetch<PipelineRunDetailDTO>(
    `/internal/v1/pipeline-runs/${encodeURIComponent(pipelineRunId)}`,
  );
}

export function triggerBronzeToSilver(
  ingestionId: string,
  reprocess = false,
): Promise<PipelineOutcomeDTO> {
  return lakehouseServiceFetch<PipelineOutcomeDTO>("/internal/v1/pipeline-runs/bronze-to-silver", {
    method: "POST",
    body: { ingestion_id: ingestionId, reprocess },
  });
}

export function triggerSilverToGold(
  silverRunId: string,
  productId?: string,
  reprocess = false,
): Promise<PipelineOutcomeDTO[]> {
  return lakehouseServiceFetch<PipelineOutcomeDTO[]>("/internal/v1/pipeline-runs/silver-to-gold", {
    method: "POST",
    body: { silver_run_id: silverRunId, product_id: productId, reprocess },
  });
}

// --- Phase 3: Gold Data Products --------------------------------------------

export interface DataProductDTO {
  data_product_id: string;
  display_name: string;
  version: string;
  gold_table: string;
  owner: string;
  description: string | null;
  status: string;
}

export function listDataProducts(): Promise<DataProductDTO[]> {
  return lakehouseServiceFetch<DataProductDTO[]>("/internal/v1/data-products");
}

export type DataProductRowDTO = Record<string, string | number | boolean | null>;

export function getDataProductRows(productId: string, limit = 100): Promise<DataProductRowDTO[]> {
  return lakehouseServiceFetch<DataProductRowDTO[]>(
    `/internal/v1/data-products/${encodeURIComponent(productId)}/rows?limit=${limit}`,
  );
}
