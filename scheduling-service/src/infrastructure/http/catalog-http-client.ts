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

// HTTP implementation of CatalogClient (AGENTS.md section 47) — talks only
// to data-product-catalog-service's public /v1/* read API (same contract
// subscription-service's own catalog-client.ts already uses), never its
// database. Version-policy resolution intentionally reproduces that same
// algorithm rather than importing across a service boundary, so the two
// services stay independently deployable — but the Catalog's live lifecycle
// status/delivery-capability answers are always fetched fresh, never
// duplicated as scheduler-owned truth.
async function catalogFetch<T>(path: string): Promise<{ status: number; json: T | undefined }> {
  if (!catalogServiceEnabled) {
    throw new DependencyError("CATALOG_SERVICE_URL is not configured.", "CATALOG", false);
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.CATALOG_SERVICE_TIMEOUT_SECONDS * 1000);
    try {
      response = await fetch(`${env.CATALOG_SERVICE_URL}${path}`, { headers: { Accept: "application/json" }, signal: controller.signal });
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
  if (response.status >= 400 && response.status !== 404) {
    throw new DependencyError(`Catalog Service returned ${response.status} for ${path}.`, "CATALOG", false);
  }

  return { status: response.status, json };
}

function majorOf(version: string): string | null {
  const match = /^(\d+)\./.exec(version);
  return match ? (match[1] as string) : null;
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

  // Mirrors subscription-service's resolveVersionPolicy exactly: EXACT
  // looks up the specific version; COMPATIBLE_MAJOR/LATEST_ACTIVE pick the
  // highest ACTIVE version, COMPATIBLE_MAJOR never crossing the requested
  // major. Never binds permanently — callers re-resolve on every
  // evaluation.
  async resolveVersionPolicy(dataProductId: string, policy: VersionPolicy): Promise<ResolvedCatalogVersion | null> {
    if (policy.type === "EXACT") {
      if (!policy.value) return null;
      const version = await this.getVersion(dataProductId, policy.value);
      return version ? { version: version.version, lifecycleStatus: version.lifecycleStatus } : null;
    }

    const items = await this.listVersions(dataProductId);
    const activeVersions = items.filter((v) => v.lifecycleStatus === "ACTIVE");
    const candidates = policy.type === "COMPATIBLE_MAJOR" ? activeVersions.filter((v) => majorOf(v.version) === policy.value) : activeVersions;
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => (a.version > b.version ? -1 : a.version < b.version ? 1 : 0));
    const best = candidates[0] as CatalogVersionInfo;
    return { version: best.version, lifecycleStatus: best.lifecycleStatus };
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
