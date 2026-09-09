import { env } from "../config/env.js";

/**
 * Outbound client for data-publication-service's own internal HTTP API
 * (`src/publication/api/` in that repo). Structurally identical to
 * ./lakehouse-client.ts and to cdep's own
 * `src/lib/publication-service/client.ts`. Used only by
 * ./pipeline-worker.service.ts.
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
  if (!env.PUBLICATION_SERVICE_URL) {
    throw new PublicationServiceError(0, "NOT_CONFIGURED", "PUBLICATION_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-key": env.PUBLICATION_SERVICE_INTERNAL_API_KEY ?? "",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${env.PUBLICATION_SERVICE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
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

export interface PublicationOutcome {
  publication_id: string;
  status: string;
  outbound_exchange_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

export function triggerPublish(pipelineRunId: string): Promise<PublicationOutcome> {
  return publicationServiceFetch<PublicationOutcome>("/internal/v1/publications", {
    method: "POST",
    body: { pipeline_run_id: pipelineRunId, republish: false },
  });
}
