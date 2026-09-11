import { DependencyError } from "../../common/errors/dependency-error.js";
import { catalogServiceEnabled, env } from "../../config/env.js";
import type {
  CatalogClient,
  CatalogProductDetail,
  CatalogVersionDetail,
  CatalogVersionInfo,
  DeliveryCapabilityResult,
  ResolvedCatalogVersion,
  VersionPolicy,
} from "../../ports/catalog-client.port.js";

// HTTP implementation of CatalogClient (AGENTS.md section 47) — talks to
// data-product-catalog-service's public /v1/* read API for product/version
// lookups (same contract subscription-service's own catalog-client.ts
// already uses), and, as of Phase 10, its internal /internal/v1/* resolver
// for version-policy resolution — never its database. Prior to Phase 10
// this client reproduced subscription-service's ranking algorithm locally;
// that was a real bug (spec's own diagnosis, see resolveVersionPolicy
// below), not a deliberate independence boundary, and is now removed in
// favor of the one shared resolver.
async function catalogFetch<T>(
  path: string,
  options: { internal?: boolean; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<{ status: number; json: T | undefined }> {
  if (!catalogServiceEnabled) {
    throw new DependencyError("CATALOG_SERVICE_URL is not configured.", "CATALOG", false);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.internal) {
    headers["x-internal-api-key"] = env.CATALOG_SERVICE_INTERNAL_API_KEY;
    headers["x-actor-type"] = "SERVICE";
    headers["x-actor-id"] = "scheduling-service";
    headers["x-actor-role"] = "CATALOG_READER";
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.CATALOG_SERVICE_TIMEOUT_SECONDS * 1000);
    try {
      response = await fetch(`${env.CATALOG_SERVICE_URL}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new DependencyError(`Catalog Service request to ${path} failed: ${(err as Error).message}`, "CATALOG", true);
  }

  const text = await response.text();
  let json: T | undefined;
  try {
    json = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    json = undefined;
  }

  if (response.status >= 500) {
    throw new DependencyError(`Catalog Service returned ${response.status} for ${path}.`, "CATALOG", true);
  }
  // Every other status (2xx, and any 4xx — 404 NOT_FOUND, 422
  // NO_COMPATIBLE_VERSION, 403 VERSION_REQUIRES_BETA_OPT_IN, 410
  // VERSION_RETIRED_UNRESOLVABLE, etc.) is returned to the caller to
  // interpret as a structured result, never thrown — per this file's own
  // documented convention (see DependencyError's comment): only network/5xx
  // failures are "the dependency is unavailable," everything else is a
  // legitimate business answer the caller decides how to handle.
  return { status: response.status, json };
}

export class CatalogHttpClient implements CatalogClient {
  async getProduct(dataProductId: string): Promise<CatalogProductDetail | null> {
    const { status, json } = await catalogFetch<CatalogProductDetail>(`/v1/data-products/${encodeURIComponent(dataProductId)}`);
    return status === 404 ? null : (json ?? null);
  }

  async getVersion(dataProductId: string, version: string): Promise<CatalogVersionDetail | null> {
    const { status, json } = await catalogFetch<CatalogVersionDetail>(
      `/v1/data-products/${encodeURIComponent(dataProductId)}/versions/${encodeURIComponent(version)}`,
    );
    return status === 404 ? null : (json ?? null);
  }

  async listVersions(dataProductId: string): Promise<CatalogVersionInfo[]> {
    const { status, json } = await catalogFetch<{ items: CatalogVersionInfo[] }>(
      `/v1/data-products/${encodeURIComponent(dataProductId)}/versions`,
    );
    if (status === 404 || !json) return [];
    return json.items;
  }

  // Phase 10 §27/§30: delegates to Catalog's centralized resolver with
  // intent="DELIVER" (the Scheduler is always a delivery-time caller).
  // This used to re-implement subscription-service's ranking algorithm
  // locally, filtered to ACTIVE only — a real bug, not just duplication:
  // a PINNED_MAJOR/COMPATIBLE_MINOR subscriber would get NO_COMPATIBLE_
  // VERSION the instant their major's canonical ACTIVE version rotated to
  // DEPRECATED, even though a perfectly good DEPRECATED-but-serving
  // version within their pinned range was still available. Never binds
  // permanently — callers re-resolve on every evaluation.
  async resolveVersionPolicy(dataProductId: string, policy: VersionPolicy): Promise<ResolvedCatalogVersion | null> {
    const { status, json } = await catalogFetch<{ resolved_version: string; lifecycle_status: string }>(
      `/internal/v1/data-products/${encodeURIComponent(dataProductId)}/resolve-version`,
      { internal: true, method: "POST", body: { policy, intent: "DELIVER" } },
    );
    if (status >= 400 || !json) return null;
    return { version: json.resolved_version, lifecycleStatus: json.lifecycle_status };
  }

  async validateDeliveryCapability(dataProductId: string, version: string, method: string, format: string | null): Promise<DeliveryCapabilityResult> {
    const detail = await this.getVersion(dataProductId, version);
    if (!detail) return { supported: false, reason: "DELIVERY_METHOD_UNSUPPORTED" };

    const supported = detail.delivery.find((d) => d.type === method);
    if (!supported) return { supported: false, reason: "DELIVERY_METHOD_UNSUPPORTED" };
    if (format && (!supported.formats || !supported.formats.includes(format))) {
      return { supported: false, reason: "FORMAT_UNSUPPORTED" };
    }
    return { supported: true };
  }
}
