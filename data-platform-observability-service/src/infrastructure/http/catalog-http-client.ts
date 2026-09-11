import { DependencyError } from "../../common/errors/dependency-error.js";
import { catalogServiceEnabled, env } from "../../config/env.js";
import type {
  CatalogClient,
  CatalogMigrationSummary,
  CatalogSla,
  CatalogVersionDetail,
  CatalogVersionSummary,
} from "../../ports/catalog-client.port.js";

interface VersionDetailWire {
  version: string;
  lifecycleStatus: string;
  sla: CatalogSla | null;
}

export class CatalogHttpClient implements CatalogClient {
  async getVersionDetail(dataProductId: string, version: string): Promise<CatalogVersionDetail | null> {
    if (!catalogServiceEnabled) return null;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.CATALOG_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        response = await fetch(
          `${env.CATALOG_SERVICE_URL}/v1/data-products/${encodeURIComponent(dataProductId)}/versions/${encodeURIComponent(version)}`,
          { headers: { Accept: "application/json" }, signal: controller.signal },
        );
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Catalog Service request failed: ${(err as Error).message}`, "CATALOG", true);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new DependencyError(`Catalog Service returned ${response.status}.`, "CATALOG", response.status >= 500);
    }

    const body = (await response.json()) as VersionDetailWire;
    return { version: body.version, lifecycleStatus: body.lifecycleStatus, sla: body.sla };
  }

  async listVersions(dataProductId: string): Promise<CatalogVersionSummary[]> {
    if (!catalogServiceEnabled) return [];
    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.CATALOG_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        response = await fetch(`${env.CATALOG_SERVICE_URL}/v1/data-products/${encodeURIComponent(dataProductId)}/versions`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Catalog Service request failed: ${(err as Error).message}`, "CATALOG", true);
    }
    if (response.status === 404) return [];
    if (!response.ok) throw new DependencyError(`Catalog Service returned ${response.status}.`, "CATALOG", response.status >= 500);
    const body = (await response.json()) as { items: Array<{ version: string; lifecycleStatus: string }> };
    return body.items.map((i) => ({ version: i.version, lifecycleStatus: i.lifecycleStatus }));
  }

  // Phase 10 §41: read-only passthrough of Catalog's migration plans, never
  // recomputed here. Internal (requires the internal API key) since
  // migration detail/subscription counts aren't customer-safe data.
  async listMigrations(dataProductId: string): Promise<CatalogMigrationSummary[]> {
    if (!catalogServiceEnabled) return [];
    const headers = {
      Accept: "application/json",
      "x-internal-api-key": env.CATALOG_SERVICE_INTERNAL_API_KEY,
      "x-actor-type": "SERVICE",
      "x-actor-id": "data-platform-observability-service",
      "x-actor-role": "CATALOG_READER",
    };
    const fetchJson = async (path: string): Promise<{ status: number; json: unknown }> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.CATALOG_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        const response = await fetch(`${env.CATALOG_SERVICE_URL}${path}`, { headers, signal: controller.signal });
        const json = response.status < 300 ? await response.json() : undefined;
        return { status: response.status, json };
      } catch (err) {
        throw new DependencyError(`Catalog Service request failed: ${(err as Error).message}`, "CATALOG", true);
      } finally {
        clearTimeout(timeout);
      }
    };

    const list = await fetchJson(`/internal/v1/data-products/${encodeURIComponent(dataProductId)}/migrations`);
    if (list.status >= 400) return [];
    const plans = (list.json as { items: Array<{ migration_id: string; to_version: string; status: string }> }).items;

    const summaries: CatalogMigrationSummary[] = [];
    for (const plan of plans) {
      if (plan.status === "COMPLETED" || plan.status === "CANCELLED") {
        summaries.push({ migrationId: plan.migration_id, toVersion: plan.to_version, status: plan.status, pendingSubscriptions: 0 });
        continue;
      }
      const detail = await fetchJson(`/internal/v1/data-products/${encodeURIComponent(dataProductId)}/migrations/${encodeURIComponent(plan.migration_id)}`);
      const subs = detail.status < 400 ? (detail.json as { subscriptions: Array<{ status: string }> }).subscriptions : [];
      const pending = subs.filter((s) => s.status === "PENDING").length;
      summaries.push({ migrationId: plan.migration_id, toVersion: plan.to_version, status: plan.status, pendingSubscriptions: pending });
    }
    return summaries;
  }
}
