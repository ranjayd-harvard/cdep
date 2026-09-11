// Boundary for data-product-catalog-service — the authoritative source for
// declared SLA (spec section 12). Read via the public, customer-safe
// version-detail route (it already embeds SLA; no dedicated internal
// SLA-only endpoint exists in this repo today).
export interface CatalogSla {
  freshnessMinutes: number | null;
  availabilityTargetPercent: number | null;
  maximumPublicationLatencyMinutes: number | null;
  deliveryDeadlineExpression: string | null;
}

export interface CatalogVersionDetail {
  version: string;
  lifecycleStatus: string;
  sla: CatalogSla | null;
}

// Phase 10 §41/§58: version-adoption metrics need to know every version's
// lifecycle status (to classify "deprecated usage") and Catalog's own
// migration-plan pending counts (a read-only passthrough, never
// recomputed here — spec §41: "exposed read-only via a thin passthrough").
export interface CatalogVersionSummary {
  version: string;
  lifecycleStatus: string;
}

export interface CatalogMigrationSummary {
  migrationId: string;
  toVersion: string;
  status: string;
  pendingSubscriptions: number;
}

export interface CatalogClient {
  getVersionDetail(dataProductId: string, version: string): Promise<CatalogVersionDetail | null>;
  listVersions(dataProductId: string): Promise<CatalogVersionSummary[]>;
  listMigrations(dataProductId: string): Promise<CatalogMigrationSummary[]>;
}
