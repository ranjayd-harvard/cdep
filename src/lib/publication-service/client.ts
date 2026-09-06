import { env } from "@/config/env";

/**
 * Server-only client for data-publication-service's own internal HTTP API
 * (`src/publication/api/` in that repo). Structurally identical to
 * `src/lib/lakehouse-service/client.ts` — same reasoning applies here:
 * data-publication-service has no tenant-JWT concept, every call is gated
 * by `x-internal-api-key` only. Used only by
 * `src/services/publication-admin/*`, wired into the server registry
 * (`src/services/index.ts`), never imported from a "use client" component.
 */

export class PublicationServiceError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "PublicationServiceError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorDetail {
  detail?: { error_code?: string; message?: string } | string;
}

async function publicationServiceFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!env.publicationServiceEnabled) {
    throw new PublicationServiceError(0, "NOT_CONFIGURED", "PUBLICATION_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-key": env.publicationServiceInternalApiKey,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.publicationServiceUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  // Same defensive parse as lakehouse-service/client.ts: a 5xx from an
  // unhandled server-side exception isn't JSON at all (FastAPI's default
  // error middleware returns a plain text body) -- never let that crash
  // the caller with a JSON.parse SyntaxError.
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
    throw new PublicationServiceError(
      response.status,
      detail?.error_code,
      message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }

  return json as T;
}

export interface PublicationRunDTO {
  publication_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  product_version: string;
  source_gold_table: string;
  source_gold_snapshot_id: string | null;
  source_pipeline_run_id: string | null;
  requested_format: string | null;
  status: string;
  input_record_count: number | null;
  output_record_count: number | null;
  artifact_count: number | null;
  outbound_exchange_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PublicationOutcomeDTO {
  publication_id: string;
  status: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  product_version: string;
  source_gold_table: string;
  source_gold_snapshot_id: string | null;
  input_record_count: number;
  output_record_count: number;
  artifact_count: number;
  outbound_exchange_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface PublicationArtifactDTO {
  artifact_id: string;
  filename: string;
  format: string;
  content_type: string | null;
  compression: string | null;
  size_bytes: number | null;
  checksum_algorithm: string | null;
  checksum: string | null;
  record_count: number | null;
}

export interface PublicationQualityResultDTO {
  rule_name: string;
  severity: string;
  total_count: number | null;
  failed_count: number | null;
  passed: boolean;
}

export interface PublicationRunDetailDTO {
  run: PublicationRunDTO;
  artifacts: PublicationArtifactDTO[];
  quality_results: PublicationQualityResultDTO[];
}

export function listPublications(limit = 50): Promise<PublicationRunDTO[]> {
  return publicationServiceFetch<PublicationRunDTO[]>(`/internal/v1/publications?limit=${limit}`);
}

export function getPublication(publicationId: string): Promise<PublicationRunDetailDTO> {
  return publicationServiceFetch<PublicationRunDetailDTO>(
    `/internal/v1/publications/${encodeURIComponent(publicationId)}`,
  );
}

export function triggerPublish(
  pipelineRunId: string,
  format?: string,
  republish = false,
): Promise<PublicationOutcomeDTO> {
  return publicationServiceFetch<PublicationOutcomeDTO>("/internal/v1/publications", {
    method: "POST",
    body: { pipeline_run_id: pipelineRunId, format: format || undefined, republish },
  });
}
