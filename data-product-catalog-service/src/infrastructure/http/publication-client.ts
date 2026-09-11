import { AppError } from "../../common/errors/app-error.js";
import { env, publicationServiceEnabled } from "../../config/env.js";

// Phase 10 §21 point 3: the retirement guard's "active publications"
// blocker check. data-publication-service's internal listing route
// (GET /internal/v1/publications) has no data_product_id/version/status
// filter at all — only `limit` — so this fetches recent runs and filters
// client-side, same discipline as scheduling-client.ts.
export class PublicationServiceUnavailableError extends AppError {
  constructor(message: string) {
    super("INTERNAL_ERROR", message);
  }
}

const TERMINAL_STATUSES = new Set(["READY", "FAILED", "EXPIRED", "SKIPPED_DUPLICATE"]);

export interface PublicationRunDTO {
  publicationId: string;
  dataProductId: string;
  productVersion: string;
  status: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  if (!publicationServiceEnabled) {
    throw new PublicationServiceUnavailableError("PUBLICATION_SERVICE_URL is not configured.");
  }
  const headers: Record<string, string> = { Accept: "application/json", "x-internal-api-key": env.PUBLICATION_SERVICE_INTERNAL_API_KEY };
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.PUBLICATION_SERVICE_TIMEOUT_SECONDS * 1000);
    try {
      response = await fetch(`${env.PUBLICATION_SERVICE_URL}${path}`, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new PublicationServiceUnavailableError(`data-publication-service request to ${path} failed: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new PublicationServiceUnavailableError(`data-publication-service returned ${response.status} for ${path}.`);
  }
  return (await response.json()) as T;
}

export async function listActivePublicationsForVersion(dataProductId: string, version: string, scanLimit = 200): Promise<PublicationRunDTO[]> {
  const runs = await fetchJson<Array<Record<string, unknown>>>(`/internal/v1/publications?limit=${scanLimit}`);
  return runs
    .filter((r) => r.data_product_id === dataProductId && r.product_version === version && !TERMINAL_STATUSES.has(r.status as string))
    .map((r) => ({
      publicationId: r.publication_id as string,
      dataProductId: r.data_product_id as string,
      productVersion: r.product_version as string,
      status: r.status as string,
    }));
}
