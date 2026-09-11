// Port for the Catalog integration boundary (spec §8.1/§8.2). Catalog
// remains the authoritative source of the published-field allowlist and
// the API query policy (filters/sorts/pagination/freshness) — this service
// never derives that from the serving-store schema.
export interface ApiContractField {
  name: string;
  type: string;
  nullable: boolean;
  // Phase 11 (spec §21) — ALLOW/REDACT/MASK/HASH, or null when the Catalog
  // contract declared no policy for this field (treated as ALLOW). DENY
  // fields never reach here at all — catalog-service excludes them from
  // publishedFields entirely (same rule FILE delivery applies).
  maskingPolicy: string | null;
}

export interface ApiContract {
  dataProductId: string;
  version: string;
  lifecycleStatus: string;
  resource: string;
  publishedFields: ApiContractField[];
  filters: string[];
  sorts: string[];
  defaultSort: string[];
  defaultPageSize: number;
  maxPageSize: number;
  maxResponseBytes: number | null;
  freshnessMinutes: number | null;
}

// Phase 10 §38: EXACT-version explicit-access route resolution. Uses the
// same centralized resolver as every other service — this one never ranks
// versions itself.
export interface ResolvedVersion {
  version: string;
  lifecycleStatus: string;
}

export interface CatalogClient {
  getApiContract(dataProductId: string, version: string): Promise<ApiContract | null>;
  resolveExactVersion(
    dataProductId: string,
    version: string,
    tenant: { organizationId: string; tenantId: string },
  ): Promise<ResolvedVersion | null>;
}
