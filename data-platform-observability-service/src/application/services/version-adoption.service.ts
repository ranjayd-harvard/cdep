import type pg from "pg";
import type { CatalogClient } from "../../ports/catalog-client.port.js";
import { aggregateExecutionsByVersion } from "../../infrastructure/persistence/execution.repository.js";

const ADOPTION_WINDOW_DAYS = 30;

export interface VersionAdoptionEntry {
  version: string;
  lifecycleStatus: string;
  subscriberCount: number;
  adoptionPercentage: number;
  executionCount: number;
  failureCount: number;
  slaPassRate: number | null;
}

// Phase 10 §41/§61: per-version adoption, computed from this service's own
// already-collected execution data (distinct correlated subscription_ids
// in the last 30 days) rather than a new bulk subscription-listing
// integration — denominator is "distinct subscribers observed for this
// product across all versions in the window," documented explicitly since
// it's an activity proxy, not a live subscription count.
export async function getVersionAdoption(
  client: pg.Pool | pg.PoolClient,
  catalogClient: CatalogClient,
  dataProductId: string,
): Promise<VersionAdoptionEntry[]> {
  const since = new Date(Date.now() - ADOPTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [versions, stats] = await Promise.all([
    catalogClient.listVersions(dataProductId),
    aggregateExecutionsByVersion(client, dataProductId, since),
  ]);

  const statsByVersion = new Map(stats.map((s) => [s.productVersion, s]));
  const totalSubscribers = stats.reduce((sum, s) => sum + s.distinctSubscribers, 0);

  return versions.map((v) => {
    const stat = statsByVersion.get(v.version);
    const subscriberCount = stat?.distinctSubscribers ?? 0;
    const executionCount = stat?.executionCount ?? 0;
    const failureCount = stat?.failureCount ?? 0;
    const slaFailCount = stat?.slaFailCount ?? 0;
    return {
      version: v.version,
      lifecycleStatus: v.lifecycleStatus,
      subscriberCount,
      adoptionPercentage: totalSubscribers > 0 ? Math.round((subscriberCount / totalSubscribers) * 1000) / 10 : 0,
      executionCount,
      failureCount,
      slaPassRate: executionCount > 0 ? Math.round(((executionCount - slaFailCount) / executionCount) * 1000) / 10 : null,
    };
  });
}

// Phase 10 §62: continuing use of DEPRECATED versions specifically — the
// operational signal that flags "consumers still riding a grace period."
export async function getDeprecatedVersionUsage(
  client: pg.Pool | pg.PoolClient,
  catalogClient: CatalogClient,
  dataProductId: string,
): Promise<VersionAdoptionEntry[]> {
  const all = await getVersionAdoption(client, catalogClient, dataProductId);
  return all.filter((v) => v.lifecycleStatus === "DEPRECATED");
}

// Phase 10 §41: thin read-only passthrough of Catalog's migration plans —
// never recomputed here.
export async function getMigrationsRemaining(catalogClient: CatalogClient, dataProductId: string) {
  const migrations = await catalogClient.listMigrations(dataProductId);
  const totalPending = migrations.reduce((sum, m) => sum + m.pendingSubscriptions, 0);
  return { migrations, totalPending };
}
